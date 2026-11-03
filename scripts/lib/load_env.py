#!/usr/bin/env python3
"""load_env.py: load named keys from a .env file or the macOS Keychain, without
ever printing them. Python standard library only.

Use it from another script:

    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lib"))
    from load_env import load_env, MissingKeys

    keys = load_env(["PORTAINER_URL", "PORTAINER_API_KEY"], file="secrets/portainer.env")
    url = keys["PORTAINER_URL"]          # never print this dict

Or run it directly to check which keys can be found (names only, never values):

    python3 scripts/lib/load_env.py --check --file secrets/portainer.env PORTAINER_API_KEY

Where each key comes from, first match wins:
  1. the environment, if the variable is set and not empty (CI secrets land here)
  2. the env file (KEY=value lines; read as data, never executed)
  3. the macOS Keychain, if a service name is given (--service, alias
     --keychain-service, or $KEYCHAIN_SERVICE):
       security find-generic-password -s SERVICE -a KEY -w

Only the keys you name are loaded.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import stat
import subprocess
import sys
from typing import Dict, Iterable, Optional, Tuple

_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class MissingKeys(Exception):
    """Raised when required keys can't be found. Carries names only."""

    def __init__(self, names, places):
        self.names = list(names)
        super().__init__(
            "missing: " + " ".join(self.names) + "\nlooked in: " + ", ".join(places)
        )


def parse_env_file(path: str) -> Dict[str, str]:
    """Parse KEY=value lines. Handles comments, `export`, quotes, inline ` #`
    comments and CRLF. No expansion and no execution. Last definition wins."""
    out: Dict[str, str] = {}
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.rstrip("\r\n").strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export "):].lstrip()
            if "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            if not _NAME.match(key):
                continue
            val = val.lstrip()
            if val[:1] in ('"', "'"):
                quote = val[0]
                end = val.find(quote, 1)
                val = val[1:end] if end != -1 else val[1:]
            else:
                val = re.split(r"\s#", val, maxsplit=1)[0].rstrip()
            out[key] = val
    return out


def _warn_mode(path: str) -> None:
    try:
        mode = stat.S_IMODE(os.stat(path).st_mode)
    except OSError:
        return
    if mode & 0o077:
        print(
            f"load_env: warning: {path} has mode {mode:o}; other users may be able "
            f"to read it. Run: chmod 600 {path}",
            file=sys.stderr,
        )


def _from_keychain(service: str, key: str) -> Optional[str]:
    if not service or not shutil.which("security"):
        return None
    try:
        res = subprocess.run(
            ["security", "find-generic-password", "-s", service, "-a", key, "-w"],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if res.returncode != 0:
        return None
    val = res.stdout.rstrip("\n")
    return val or None


def lookup(
    keys: Iterable[str], file: Optional[str] = None, service: Optional[str] = None
) -> Dict[str, Tuple[str, str]]:
    """Return {key: (value, source)} for every key that can be found."""
    service = service if service is not None else os.environ.get("KEYCHAIN_SERVICE", "")
    file_vals: Dict[str, str] = {}
    if file and os.path.isfile(file):
        _warn_mode(file)
        file_vals = parse_env_file(file)
    found: Dict[str, Tuple[str, str]] = {}
    for key in keys:
        if not _NAME.match(key):
            raise ValueError(f"not a valid variable name: {key}")
        if os.environ.get(key):
            found[key] = (os.environ[key], "environment")
        elif file_vals.get(key):
            found[key] = (file_vals[key], f"file {file}")
        else:
            val = _from_keychain(service, key)
            if val:
                found[key] = (val, f"Keychain service {service}")
    return found


def load_env(
    keys: Iterable[str],
    file: Optional[str] = None,
    service: Optional[str] = None,
    required: bool = True,
    export: bool = False,
) -> Dict[str, str]:
    """Return {key: value} for the named keys. Raises MissingKeys (names only)
    if a required key can't be found. With export=True, also sets os.environ
    so child processes inherit the values (better than passing them as
    arguments)."""
    keys = list(keys)
    found = lookup(keys, file=file, service=service)
    missing = [k for k in keys if k not in found]
    if missing and required:
        places = ["the environment"]
        if file:
            places.append(file if os.path.isfile(file) else f"{file} (not found)")
        svc = service if service is not None else os.environ.get("KEYCHAIN_SERVICE", "")
        if svc:
            places.append(f"Keychain service {svc}")
        raise MissingKeys(missing, places)
    values = {k: v for k, (v, _src) in found.items()}
    if export:
        os.environ.update(values)
    return values


def _main(argv) -> int:
    ap = argparse.ArgumentParser(
        description="Report where each key would be loaded from. Prints names, sources "
        "and lengths only, never values."
    )
    ap.add_argument("--check", action="store_true", help="(default) report only")
    ap.add_argument("--file", help="env file to read, e.g. secrets/portainer.env")
    ap.add_argument("--service", "--keychain-service", dest="service",
                    help="macOS Keychain service name to fall back to")
    ap.add_argument("keys", nargs="+", metavar="KEY")
    args = ap.parse_args(argv)
    try:
        found = lookup(args.keys, file=args.file, service=args.service)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 2
    rc = 0
    for key in args.keys:
        if key in found:
            val, src = found[key]
            print(f"{key:<32} found ({src}, {len(val)} chars)")
        else:
            print(f"{key:<32} MISSING")
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
