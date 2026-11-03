#!/usr/bin/env python3
"""redeploy.py: "Pull and redeploy" a Portainer Git stack, safely, then wait
until the app reports the new commit.

    python3 scripts/portainer/redeploy.py --stack maps --dry-run
    python3 scripts/portainer/redeploy.py --stack maps --check
    python3 scripts/portainer/redeploy.py --stack maps \\
        --health-url https://maps.example.com/health --expect-commit origin/main

What it does:
  1. GET the stack from the Portainer API.
  2. Build the redeploy body FROM that stack, copying its Env back unchanged.
     The redeploy call REPLACES the stack's environment: leave Env out and
     every secret is wiped (docs/08, section 5).
  3. PUT /api/stacks/{id}/git/redeploy with pullImage=true (the API name for
     the "Re-pull image" switch; without it a :latest redeploy changes nothing).
  4. Poll the app's health URL until it reports the expected commit. An HTTP
     200 from Portainer doesn't prove the new build is live.

Modes:
  --dry-run   no network at all: prints the calls it would make
  --check     read-only: GETs the stack and prints what the PUT would send,
              with Env shown as variable NAMES only
  (neither)   asks before the PUT, unless --yes

Keys: PORTAINER_URL and PORTAINER_API_KEY come from --env-file (default
secrets/portainer.env), the environment, or the macOS Keychain
(--keychain-service). They are never printed, never put on a command line,
and the request body (which holds every stack secret) is never printed or
written to disk.

Python 3.8+ standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.dont_write_bytecode = True  # keep scripts/lib free of __pycache__
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from load_env import MissingKeys, load_env  # noqa: E402

SHA_RE = re.compile(r"^[0-9a-fA-F]{7,40}$")


class Redactor:
    """Replaces any known secret value in text before it is shown."""

    def __init__(self):
        self.values = []

    def add(self, *vals):
        for v in vals:
            if isinstance(v, str) and len(v) >= 4:
                self.values.append(v)
        self.values.sort(key=len, reverse=True)

    def __call__(self, text: str) -> str:
        for v in self.values:
            text = text.replace(v, "<redacted>")
        return text


REDACT = Redactor()


def say(msg: str = "") -> None:
    print(REDACT(msg), flush=True)


def fail(msg: str, code: int = 1) -> None:
    print("error: " + REDACT(msg), file=sys.stderr, flush=True)
    sys.exit(code)


def resolve_commit(value: str) -> str:
    """A hex SHA is used as is. Anything else is treated as a git ref
    (origin/main, HEAD) and resolved in the current repo."""
    if not value:
        return ""
    if SHA_RE.match(value):
        return value.lower()
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", value + "^{commit}"],
            capture_output=True, text=True, timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        out = None
    if not out or out.returncode != 0 or not out.stdout.strip():
        fail(f"--expect-commit {value!r} is neither a SHA nor a git ref this repo knows", 2)
    return out.stdout.strip().lower()


class Portainer:
    def __init__(self, base_url: str, api_key: str, insecure: bool):
        self.base = base_url.rstrip("/")
        self.key = api_key
        self.ctx = ssl.create_default_context()
        if insecure:
            self.ctx.check_hostname = False
            self.ctx.verify_mode = ssl.CERT_NONE

    def call(self, method: str, path: str, body=None, timeout: int = 30):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("X-API-Key", self.key)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=timeout) as res:
                raw = res.read()
                return res.status, (json.loads(raw) if raw.strip() else None)
        except urllib.error.HTTPError as exc:
            raw = exc.read()[:2000].decode("utf-8", "replace")
            try:
                parsed = json.loads(raw)
                msg = parsed.get("message") or parsed.get("details") or raw
            except (ValueError, AttributeError):
                msg = raw
            fail(f"{method} {path} -> HTTP {exc.code}: {str(msg)[:300]}")
        except urllib.error.URLError as exc:
            hint = ""
            if "CERTIFICATE_VERIFY_FAILED" in str(exc.reason):
                hint = " (self-signed certificate? use --insecure only for a Portainer you run yourself)"
            fail(f"{method} {path}: can't reach Portainer: {exc.reason}{hint}")
        except (TimeoutError, OSError) as exc:  # socket.timeout is an OSError before 3.10
            fail(f"{method} {path}: network error or timeout after {timeout}s: {type(exc).__name__}")


def find_stack_id(api: Portainer, name: str) -> int:
    _, stacks = api.call("GET", "/api/stacks")
    matches = [s for s in (stacks or []) if s.get("Name") == name]
    if not matches:
        names = sorted(s.get("Name", "?") for s in (stacks or []))
        fail(f"no stack named {name!r}. Stacks this key can see: {', '.join(names) or 'none'}")
    if len(matches) > 1:
        ids = ", ".join(str(s.get("Id")) for s in matches)
        fail(f"{len(matches)} stacks are named {name!r} (ids {ids}); use --stack-id")
    return int(matches[0]["Id"])


def build_body(stack: dict, prune: bool) -> dict:
    if "Env" not in stack:
        fail("the stack has no 'Env' field in the API response. Refusing to redeploy: "
             "sending a body without the env would wipe it.")
    git = stack.get("GitConfig")
    if not git:
        fail("this stack wasn't created from a Git repository; this script only redeploys Git stacks")
    auth = git.get("Authentication") or {}
    body = {
        "env": stack.get("Env") or [],   # MUST go back unchanged
        "prune": prune,
        "pullImage": True,               # the API name for "Re-pull image"
        "repositoryReferenceName": git.get("ReferenceName") or "refs/heads/main",
        "repositoryAuthentication": bool(auth),
    }
    if auth:
        # With authentication on, Portainer takes the username from this body (it only
        # falls back to the stored password), so send the saved one back too. Leaving it
        # out can blank the stack's saved Git username. Never printed.
        body["repositoryUsername"] = auth.get("Username") or ""
    return body


def describe(stack: dict, body: dict, endpoint_id: int) -> None:
    git = stack.get("GitConfig") or {}
    env_names = [e.get("name", "?") for e in body["env"]]
    say(f"stack        {stack.get('Name')} (id {stack.get('Id')}, endpoint {endpoint_id})")
    say(f"git          {git.get('ReferenceName', '?')}, compose file {git.get('ConfigFilePath', '?')}")
    say(f"env kept     {len(env_names)} variable(s): {', '.join(env_names) or '(none)'}")
    say(f"pullImage    {body['pullImage']}   prune {body['prune']}   "
        f"repo auth {body['repositoryAuthentication']}")


def read_health(url: str, field: str, insecure: bool, timeout: int = 10):
    """Return (ok, status, commit, note). Never raises."""
    ctx = ssl.create_default_context()
    if insecure:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={"Accept": "application/json",
                                               "Cache-Control": "no-cache",
                                               "User-Agent": "redeploy-check/1"})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as res:
            raw = res.read(65536)
            code = res.status
    except urllib.error.HTTPError as exc:
        hint = " (proxy up, app not answering yet)" if exc.code in (502, 503, 504) else ""
        return False, f"HTTP {exc.code}{hint}", "", ""
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return False, f"unreachable: {getattr(exc, 'reason', exc)}", "", ""
    try:
        data = json.loads(raw)
    except ValueError:
        return code == 200, f"HTTP {code}, not JSON", "", ""
    val = data
    for part in field.split("."):
        val = val.get(part) if isinstance(val, dict) else None
    status = str(data.get("status", "?")) if isinstance(data, dict) else "?"
    return code == 200, status, str(val or ""), str(data.get("version", "")) if isinstance(data, dict) else ""


def commit_matches(have: str, want: str) -> bool:
    have, want = have.lower(), want.lower()
    return bool(have) and (have.startswith(want) or want.startswith(have)) and min(len(have), len(want)) >= 7


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Pull and redeploy a Portainer Git stack, keeping its Env, then wait for the new commit.",
        epilog="Production redeploys need a person's explicit OK in this session (docs/12).",
    )
    who = ap.add_mutually_exclusive_group(required=True)
    who.add_argument("--stack", help="stack name as shown in Portainer")
    who.add_argument("--stack-id", type=int, help="stack id")
    ap.add_argument("--endpoint-id", type=int, help="override the stack's EndpointId")
    ap.add_argument("--health-url", help="app health URL to poll after the redeploy")
    ap.add_argument("--expect-commit", default="",
                    help="SHA, or a git ref like origin/main, that /health must report")
    ap.add_argument("--commit-field", default="commit_sha", help="JSON field with the commit (default commit_sha)")
    ap.add_argument("--timeout", type=int, default=300, help="seconds to wait for the new commit (default 300)")
    ap.add_argument("--interval", type=int, default=5, help="seconds between health polls (default 5)")
    ap.add_argument("--prune", action="store_true", help="also remove services no longer in the compose file")
    ap.add_argument("--insecure", action="store_true",
                    help="skip TLS verification (only for your own Portainer with a self-signed cert)")
    ap.add_argument("--env-file", default=os.environ.get("PORTAINER_ENV_FILE", "secrets/portainer.env"))
    ap.add_argument("--keychain-service", default=None, help="macOS Keychain service to fall back to")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="no network: print the planned calls")
    mode.add_argument("--check", action="store_true", help="read-only: GET the stack, show the planned PUT")
    ap.add_argument("--yes", action="store_true", help="don't ask before the PUT (only after a person said go)")
    args = ap.parse_args(argv)

    if args.dry_run:
        # Don't resolve --expect-commit here: a dry run may happen outside the app's
        # clone, where a ref like origin/main means nothing. Show it as given.
        expect = args.expect_commit
        url = "$PORTAINER_URL"  # not read, not printed: even a hostname can be private
        stack_ref = f"<id of stack {args.stack!r}>" if args.stack else str(args.stack_id)
        say("DRY RUN: no network calls, no key needed")
        if args.stack:
            say(f"  GET  {url}/api/stacks                       find the id of stack {args.stack!r}")
        say(f"  GET  {url}/api/stacks/{stack_ref}")
        say("       check it has Env and GitConfig; copy Env into the body unchanged")
        ep = args.endpoint_id if args.endpoint_id is not None else "<the stack's EndpointId>"
        say(f"  PUT  {url}/api/stacks/{stack_ref}/git/redeploy?endpointId={ep}")
        say(f"       body: env=<copied>, pullImage=true, prune={str(args.prune).lower()}, "
            "repositoryReferenceName=<from GitConfig>, repositoryAuthentication=<from GitConfig>, "
            "repositoryUsername=<from GitConfig, when authentication is on>")
        if args.health_url:
            if not expect:
                target = "status ok"
            elif SHA_RE.match(expect):
                target = f"commit {expect[:12]}"
            else:
                target = f"the commit {expect!r} points to (resolved with git when it really runs)"
            say(f"  then poll {args.health_url} every {args.interval}s for up to {args.timeout}s until it reports {target}")
        else:
            say("  (no --health-url: it would stop after the PUT and remind you to check /health)")
        return 0

    expect = resolve_commit(args.expect_commit)

    try:
        keys = load_env(["PORTAINER_URL", "PORTAINER_API_KEY"], file=args.env_file,
                        service=args.keychain_service)
    except MissingKeys as exc:
        fail(f"{exc}\nSee scripts/portainer/portainer.env.example.")
    REDACT.add(keys["PORTAINER_API_KEY"])
    if not keys["PORTAINER_URL"].startswith(("https://", "http://")):
        fail("PORTAINER_URL must start with https:// (or http:// on a trusted network)")
    if keys["PORTAINER_URL"].startswith("http://"):
        print("warning: PORTAINER_URL is plain http; the API key crosses the network unencrypted",
              file=sys.stderr)

    api = Portainer(keys["PORTAINER_URL"], keys["PORTAINER_API_KEY"], args.insecure)
    stack_id = args.stack_id if args.stack_id is not None else find_stack_id(api, args.stack)
    _, stack = api.call("GET", f"/api/stacks/{stack_id}")
    if not isinstance(stack, dict):
        fail("unexpected answer for the stack")
    for e in stack.get("Env") or []:
        REDACT.add(e.get("value"))
    endpoint_id = args.endpoint_id if args.endpoint_id is not None else stack.get("EndpointId")
    if endpoint_id is None:
        fail("the stack has no EndpointId; pass --endpoint-id")
    body = build_body(stack, args.prune)
    describe(stack, body, int(endpoint_id))

    before = None
    if args.health_url:
        ok, status, commit, version = read_health(args.health_url, args.commit_field, False)
        before = commit
        say(f"health now   {status}, version {version or '-'}, commit {commit[:12] or '-'}")
        if expect and commit_matches(commit, expect):
            say(f"note: the app already reports {expect[:12]}; redeploying anyway re-pulls the same build")

    if args.check:
        say("CHECK: read-only, nothing changed")
        return 0

    if not args.yes:
        if not sys.stdin.isatty():
            fail("no terminal to ask on. Re-run with --yes only after a person has approved this redeploy.")
        answer = input(f"Redeploy stack {stack.get('Name')!r} now? [y/N] ").strip().lower()
        if answer not in ("y", "yes"):
            say("stopped. Nothing was changed.")
            return 1

    say("redeploying (Portainer pulls the images first; this can take a few minutes)")
    started = time.time()
    status_code, _ = api.call("PUT", f"/api/stacks/{stack_id}/git/redeploy?endpointId={int(endpoint_id)}",
                              body=body, timeout=600)
    say(f"Portainer answered HTTP {status_code} after {int(time.time() - started)}s")
    del body

    if not args.health_url:
        say("no --health-url given, so the new build is NOT confirmed. Check /health (version, commit_sha, "
            "built_at, started_at) before calling it done.")
        return 0

    deadline = time.time() + args.timeout
    last = ""
    while True:
        ok, status, commit, version = read_health(args.health_url, args.commit_field, False)
        line = f"{status}, version {version or '-'}, commit {commit[:12] or '-'}"
        if line != last:
            say(f"health       {line}")
            last = line
        if ok:
            if expect and commit_matches(commit, expect):
                say(f"LIVE: {args.health_url} reports commit {commit[:12]}")
                return 0
            if not expect and status.lower() in ("ok", "healthy", "pass", "up"):
                changed = "a different commit" if before and commit and commit != before else "no commit change seen"
                say(f"UP: status {status} ({changed}). Pass --expect-commit to confirm the exact build.")
                return 0
        if time.time() >= deadline:
            want = f"commit {expect[:12]}" if expect else "status ok"
            fail(f"gave up after {args.timeout}s waiting for {want}. Last seen: {line}. "
                 "Was CI finished (scripts/ci/wait-for-build.sh)? Check the stack's logs in Portainer.")
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
