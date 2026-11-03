# 14 · Key-safe scripts: give the agent scripts, not keys

**Use it when:** a job needs an API key (redeploy a stack, update a DNS record, pull a report, create a server), or you notice that you've been pasting keys into the chat.
**Fill in:** `<job>` (one sentence, for example "list the Cloudflare DNS records for one zone"), `<service>` (for example Cloudflare), `<KEY_NAMES>` (for example `CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID`), and `<script-path>` (for example `scripts/cloudflare/list-records.sh`).
**Read first:** `docs/playbook/12-keys-and-scripts.md` (all of it).

Before you start, make the key yourself, with the narrowest scope the job needs and an expiry. Put it in `secrets/<service>.env` (`chmod 600`) or in the Keychain with `security add-generic-password -U -s <project> -a <KEY_NAME> -w`. Don't paste it into the chat.

```text
Goal
Write ONE single-purpose script, <script-path>, that does this job: <job>. It reads <KEY_NAMES> at run
time and never shows them, so neither of us ever needs the key in this chat. Read
docs/playbook/12-keys-and-scripts.md first and follow its "rules for a key-safe script" exactly.
Also set up the repo so keys can't slip into it.

What to build
1. Repo hygiene (only what's missing):
   - secrets/ with chmod 700. Don't create or edit any real env file in it.
   - .gitignore: /secrets/ (anchored, so scripts/secrets/ isn't ignored), .env, .env.*, *.env,
     !.env.example, !*.env.example, *.pem, *.key, inbox/*, outbox/*.
   - .dockerignore: secrets, .env, .env.*, *.env.
   - scripts/lib/load-env.sh and scripts/lib/load_env.py, copied from the playbook's scripts/lib/.
   - scripts/secrets/scan-before-push.sh, copied from the playbook.
2. <script-path>:
   - Bash with set -euo pipefail (or Python 3 with the standard library only).
   - Loads <KEY_NAMES> with load_env from the environment, secrets/<service>.env, or the Keychain
     (KEYCHAIN_SERVICE in the environment, or a --keychain-service NAME flag, like the playbook's scripts).
     Never takes a key as an argument.
   - --help, and a --dry-run that needs NO key and makes NO network calls: it prints the requests it
     would make.
   - Does only <job>. No "run any request" mode and no pass-through of arbitrary paths or flags.
   - Prints only safe results (IDs, names, counts, HTTP status codes). Never whole responses. Errors
     show the status and a short message with known secret values replaced by <redacted>.
   - Sends the key in a header built inside the script, from the environment, never on a command
     line or in a URL. If it calls curl, use -H @file from a mktemp file with chmod 600 that a trap
     deletes, or use Python's urllib.
   - Never uses set -x, and never echoes a variable that holds a key.
   - If the job changes or deletes anything, or costs money: a confirmation prompt, and --yes to skip
     it, which you only use after I say go.
   - Exit codes: 0 done, 1 failed, 2 bad arguments.
3. <script-path minus extension>.env.example next to it: every name it reads, fake values
   (YOUR_TOKEN), and a comment saying where the real file goes and how to chmod it.
4. A short section in scripts/README.md (create it if needed): what the script does, which key and scope
   it needs, and an example run.
5. Install the pre-push hook from docs/playbook/12 section 5 in this clone, using my env files and
   secrets/denylist.txt if they exist. Tell me which files it uses, not what's in them.

Constraints
- Never ask me for a key. Never read, cat, grep, print or open secrets/* or any *.env other than
  *.env.example. To check a key exists, run scripts/lib/load-env.sh --check (names only).
- Never put a key in code, tests, fixtures, docs, commit messages, settings or permission files.
- Don't call the real service until I say so. Until then, only --help and --dry-run.
- Keep it small. One job. If you think it needs a second job, write a second script and ask first.

Acceptance checks
- bash -n (or python3 -m py_compile) passes, and shellcheck is clean if it's installed.
- <script-path> --help and --dry-run work with NO env file present, and make no network calls.
- Leak test: create a temp dir with a fake env file whose key value is FAKE-KEY-0123456789abcdef.
  Run the script against it with --dry-run, and also for real against a URL that can't succeed
  (for example https://127.0.0.1:9/). Pipe stdout and stderr through grep -c FAKE-KEY-0123456789abcdef.
  The count must be 0. Delete the temp dir afterwards.
- grep the script: no `set -x`, no `echo "$<KEY>"`, no key in any curl argument or URL.
- git check-ignore -q secrets/<service>.env succeeds, and git check-ignore -q scripts/secrets/scan-before-push.sh
  FAILS (the scanner must stay committable).
- scripts/secrets/scan-before-push.sh --env-file secrets/<service>.env reports no findings. (If the real
  env file doesn't exist yet, run it without --env-file and say so.)
- scripts/lib/load-env.sh --check --file secrets/<service>.env <KEY_NAMES> shows names and "found" or
  "MISSING" only.

How to verify (show me)
- The script's --help and --dry-run output.
- The leak test's command and its count of 0.
- The scan summary line and the check-ignore results.
- Then STOP. I'll run the first real call myself, or tell you to.
```

## After it works

Add a line to your agent's house rules so the habit sticks: "Jobs that need a key go through a script in `scripts/`. Never ask me for the key." The full block of suggested rules is in docs/12, section 4.
