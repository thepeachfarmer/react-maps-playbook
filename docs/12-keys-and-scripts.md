# 12 · Keys and scripts: keeping secrets out of chats, commits and logs

Every map app ends up holding keys: a DigitalOcean token, a Portainer API key, a Cloudflare DNS token, an OIDC client secret, a database password. When you work with an AI coding agent, there are more ways for a key to escape than there used to be: the chat, the agent's transcript, a "helpful" curl example, a settings file, a commit. This doc covers how we stop that, and the scripts in `scripts/` that do it for you.

## The rules, short version

1. **A key you pasted into a prompt, a chat, an issue or a screenshot is exposed.** Revoke it and make a new one. Deleting the message doesn't un-send it.
2. **Make small keys:** scoped to one job, with an expiry.
3. **Keys live in exactly two places on your Mac:** a gitignored env file in `secrets/` with `chmod 600`, or the macOS Keychain.
4. **Never put a key on a command line, in a URL, in a settings file or in a commit.**
5. **Give the agent scripts, not keys.** A script reads the key when it runs, does one job, and prints only safe results.
6. **Scan before you push:** `scripts/secrets/scan-before-push.sh`.
7. **If a key leaks:** revoke it first, then rotate, check the logs and clean up the history.

## 1. Why a pasted key counts as leaked

- **Chats and transcripts are kept.** An AI conversation is stored on your machine, at the provider, or both. It may be synced, shared, exported or read in a review. You can't take it back.
- **An agent that reads a file containing a key now has that key in its transcript.** Even a trustworthy agent can repeat it: in a reply, in a commit message, or in a curl example it writes for you.
- **Issues, pull requests and wikis get indexed and emailed.** Bots scan public GitHub for keys within minutes of a push.
- **Screenshots travel.** The terminal behind your map screenshot may have a token in it.

So the rule is simple. **If a key went somewhere it shouldn't, revoke it and make a new one.** It takes two minutes, and it's the only step that actually stops the old key working.

## 2. Small keys: scoped, expiring, one per job

A key that can do everything is a disaster when it leaks. A key that can only do one thing, for 90 days, is an annoyance.

| Job | Key | Scope it to |
|---|---|---|
| Provision droplets | DigitalOcean API token | Custom scopes: droplet, firewall, reserved IP, domain, SSH key, tag, actions. Not billing, not Spaces. Expiry 30–90 days. |
| Redeploy a stack | Portainer access token | A Portainer user who can see only the environment it deploys to |
| Caddy's DNS-01 challenge | Cloudflare API token | "Edit zone DNS" for **one** zone |
| Pull a private image on a server | GitHub token | `read:packages` only |
| Pull a private repo on a server | Deploy key | One repo, read-only (the default) |
| CI pushing images | The built-in `GITHUB_TOKEN` | `packages: write` in the workflow. No personal token needed. |

- **Name each key after its job and its machine** (`laptop-provision-droplets`), so you know exactly what to revoke.
- **Set an expiry and a calendar reminder.** A key you forgot about is a key nobody is watching.
- **One key per job.** If the Cloudflare token leaks, you revoke it, and the droplet scripts keep working.

## 3. Where keys live

### Option A: a gitignored env file in `secrets/`

```
your-repo/
├── secrets/              chmod 700, gitignored, dockerignored
│   ├── do.env            DIGITALOCEAN_ACCESS_TOKEN=...      chmod 600
│   ├── portainer.env     PORTAINER_URL=...  PORTAINER_API_KEY=...
│   └── denylist.txt      private names for the scanner (section 5)
└── scripts/
    ├── do/do.env.example                 committed: the same names, fake values
    └── portainer/portainer.env.example
```

```sh
mkdir -p secrets && chmod 700 secrets
cp scripts/do/do.env.example secrets/do.env && chmod 600 secrets/do.env
"${EDITOR:-nano}" secrets/do.env          # type the key in the editor, not on a command line
```

```gitignore
# .gitignore. Anchor /secrets/ to the repo root: an unanchored "secrets/" also
# ignores scripts/secrets/, which holds the scanner you DO want to commit.
/secrets/
.env
.env.*
*.env
!.env.example
!*.env.example
*.pem
*.key
# what you drop for the agent, and what it makes for you (screenshots of the real app land here)
inbox/*
!inbox/.gitkeep
outbox/*
!outbox/.gitkeep
```

Add `secrets`, `.env`, `.env.*` and `*.env` to `.dockerignore` too, so a key, or the denylist of private names, can never be copied into an image by a `COPY . .`.

### Option B: the macOS Keychain

The Keychain is encrypted on disk and locked when you log out. A plain env file is neither.

```sh
# Store. -w as the LAST argument makes it prompt for the value, so it never touches shell history.
security add-generic-password -U -s react-maps -a DIGITALOCEAN_ACCESS_TOKEN -w

# Read. This prints the key: do it only inside scripts, never where an agent sees the output.
security find-generic-password -s react-maps -a DIGITALOCEAN_ACCESS_TOKEN -w

# Remove.
security delete-generic-password -s react-maps -a DIGITALOCEAN_ACCESS_TOKEN
```

`-s` is a "service" name you choose (one per project is tidy) and `-a` is the key's name. The first time a script reads the item, macOS may ask whether to allow it. Choose "Always Allow" only for the terminal you use.

The scripts in `scripts/` look in three places, in this order: the environment (that's how CI secrets arrive), then the env file, then the Keychain. For the Keychain, set `KEYCHAIN_SERVICE=react-maps` in the environment, or pass `--keychain-service react-maps` to any of them (`provision-droplet.sh`, `destroy-droplet.sh`, `redeploy.py`, and `load-env.sh --check` / `load_env.py --check`, which also take the shorter `--service`).

### Never in these places

| Place | Why not |
|---|---|
| **A command line** (`curl -H "Authorization: Bearer dop_v1_…"`) | It lands in your shell history and is visible in `ps` to other processes. An agent's permission allowlist may save the whole command into a settings file. |
| **A URL** (`?token=…`, `https://<token>@github.com/…`) | URLs end up in server logs, proxy logs, browser history and `Referer` headers. A token in a clone URL is saved in `.git/config`. |
| **Settings files** (an agent's `settings.local.json`, editor settings, `~/.npmrc` in the repo) | They get committed, synced and shared, and they're read on every session. |
| **A commit** | Git history is forever. Deleting the line in the next commit leaves it in the old one. |
| **A Docker image** | Anyone who can pull the image can read every file in it, and `docker history` shows build arguments. |
| **cloud-init user data** | Readable from inside the server and in the control panel (docs/11). |
| **Logs and screenshots** | `set -x`, a debug print of a request or an API response dump puts the key in a file someone will paste into an issue. |

## 4. Give the agent scripts, not keys

Here's the pattern we use with AI agents. **The agent never sees a key.** It runs a script, the script reads the key from `secrets/` or the Keychain at run time, does one job, and prints only results that are safe to show. The agent can't paste a key it never had into a reply, a commit or a log.

```
You: "Create the droplet for the maps app."
Agent: runs scripts/do/provision-droplet.sh --dry-run, and shows you the plan and the cost
You: "Looks right, go."
Agent: runs scripts/do/provision-droplet.sh --yes
Script: reads DIGITALOCEAN_ACCESS_TOKEN from secrets/do.env, never prints it
Output: droplet_id=123456789
        ip=203.0.113.10
```

### The rules for a key-safe script

1. **It reads the key at run time** from the env file or the Keychain (use `scripts/lib/load-env.sh` or `scripts/lib/load_env.py`). It never takes the key as an argument.
2. **It never prints the key.** No `echo "$TOKEN"`, no `set -x` (a trace prints every expanded value), and no dumping whole API responses, because a Portainer stack response holds every password the stack has.
3. **It does one job, and its name says what.** `provision-droplet.sh`, not `do-api.sh "$ANY_PATH"`. A script that makes any API call you ask for is just the key with extra steps.
4. **It prints only safe results:** IDs, IP addresses, names, HTTP status codes and counts. For errors, the status code and a short message with known secret values redacted.
5. **If it changes anything, it has a `--dry-run` that needs no key at all,** so the agent can show you the plan before anything happens. A read-only script (a health check, a key check) doesn't need one.
6. **It asks before it spends money or touches production.** `--yes` skips the question, and the agent may use it only after you've said go in that session (the house rules in `prompts/README.md`).
7. **It passes secrets to child processes through the environment or stdin** (`docker login --password-stdin`, `curl -H @file`), never as arguments.
8. **Temp files that hold secrets** are made with `mktemp` and `chmod 600` and deleted on exit with a `trap`. Better still, keep the secret in memory.

### A template

```bash
#!/usr/bin/env bash
# list-droplets.sh: print the name, ID and IP of each droplet. Nothing else.
set -euo pipefail
cd "$(dirname "$0")/../.."                       # run from the repo root
. scripts/lib/load-env.sh

if [ "${1:-}" = --dry-run ]; then
  echo "would run: doctl compute droplet list --format Name,ID,PublicIPv4 --no-header"
  exit 0
fi

load_env --file secrets/do.env DIGITALOCEAN_ACCESS_TOKEN || exit 1
export DIGITALOCEAN_ACCESS_TOKEN                 # doctl reads it from the environment

doctl compute droplet list --format Name,ID,PublicIPv4 --no-header
```

To check a key is in place without showing it (names, where it was found and its length only):

```sh
scripts/lib/load-env.sh --check --file secrets/do.env DIGITALOCEAN_ACCESS_TOKEN
# DIGITALOCEAN_ACCESS_TOKEN        found (file secrets/do.env, 71 chars)
```

### House rules for your agent

These are already part of the house rules block in `prompts/README.md`. If your agent's instructions file is older than that, add them:

```text
Keys
- Never ask me to paste a key, token or password into the chat. If a task needs one, use (or write) a
  single-purpose script in scripts/ that reads it from secrets/*.env or the macOS Keychain at run time.
- Never read, cat, grep, print or open files in secrets/ or any *.env file (except *.env.example).
  To check that a key exists, run scripts/lib/load-env.sh --check, which prints names only.
- Never put a key on a command line, in a URL, in a settings or permissions file, or in a commit.
- Never use set -x in a script that handles keys. Never print whole API responses.
- Run every script that changes something with --dry-run first and show me the plan (read-only ones such
  as check-health.sh and load-env.sh --check have no --dry-run). Use --yes only after I say go.
- Run scripts/secrets/scan-before-push.sh before every push and show me its summary.
- If you see a key anywhere it shouldn't be, stop and tell me which file and line. Don't repeat the value.
```

Many agents also let you **deny file reads by path** in their settings. Deny `secrets/**` and `**/*.env`, so a slip can't happen even by accident.

## 5. Scan before you push

`scripts/secrets/scan-before-push.sh` looks at every file git would commit and prints **where** something looks wrong and **what kind** of thing it is. It never prints the value.

```sh
scripts/secrets/scan-before-push.sh \
  --env-file secrets/do.env --env-file secrets/portainer.env \
  --denylist secrets/denylist.txt
```

```
Findings in ~/projects/maps (212 files; checked key shapes, private IPs, emails, secret files, 3 env value(s), 6 denylist term(s)):

  docs/deploy-notes.md:14                          env-value    value of PORTAINER_URL from secrets/portainer.env
  server/src/config.ts:9                           private-ip   private IP (192.168.x)
  scripts/old-deploy.sh:3                          key-shaped   DigitalOcean token

3 finding(s): 1 env-value, 1 key-shaped, 1 private-ip
```

What it checks:

- **Key-shaped strings:** private key blocks, GitHub, DigitalOcean, AWS, Slack, Stripe, Google and OpenAI/Anthropic-style keys, Portainer tokens, JWTs, passwords inside URLs, and long values assigned to names like `*_TOKEN` or `*SECRET`.
- **Private addresses:** 10.x, 172.16–31.x, 192.168.x and the 100.64–127.x range that VPNs use.
- **Email addresses,** skipping example.com and noreply addresses.
- **Files that shouldn't be committed:** `.env` files, private keys, keystores, service-account JSON, and any env file you pass that isn't gitignored.
- **Every value in the env files you pass** (8 characters or more), wherever it shows up. This catches what no generic scanner can know about: your real hostname in a doc, your Portainer URL in a README, a password pasted into a test.
- **Every line of your denylist:** names of people, companies, fields, servers, your GitHub org. Keep that file in `secrets/` too, because the list itself is private.

Run it with `--history` before a repo goes public. It then also searches every old commit, and lists separately anything that's gone from today's files but still sits in the history.

**Make it automatic** with a pre-push hook. Hooks aren't committed, so install it in each clone. It passes only the env files and denylist that exist in that clone, because the scanner stops with an error (and the hook blocks every push) when a file you name is missing:

```sh
cat > .git/hooks/pre-push <<'EOF'
#!/bin/sh
set --
for f in secrets/*.env; do [ -f "$f" ] && set -- "$@" --env-file "$f"; done
[ -f secrets/denylist.txt ] && set -- "$@" --denylist secrets/denylist.txt
exec scripts/secrets/scan-before-push.sh "$@"
EOF
chmod +x .git/hooks/pre-push
```

A line that has to contain something scanner-shaped, such as a documentation example, can carry the marker `scan:allow`. Every check except the env-value one skips that line. A real value from your env files is never allowed through.

**It doesn't replace** a dedicated scanner such as gitleaks or trufflehog, which know hundreds of key formats. Use both. It also can't see inside images, so look at your screenshots yourself (docs/09).

## 6. If a key leaks

Do these **in this order:**

1. **Revoke it now,** in the provider's dashboard, before you clean anything up. Revoking is the only step that stops the key working. Bots that scan GitHub use leaked keys within minutes.
2. **Make a replacement** with the same narrow scope, and put it where the old one lived: `secrets/*.env`, the Keychain, the Portainer stack environment, CI secrets.
3. **Check what the old key did** in the provider's audit or activity log, from the time of the leak until you revoked it. Look for new droplets (crypto miners are the classic), DNS changes, new users, new tokens and logins you don't recognise. Check the bill too.
4. **Clean up where it leaked.** In a commit: rewrite the history with `git filter-repo --replace-text` (or BFG) and force-push. Treat that as tidying, not as the fix, because clones, forks and caches keep the old commits. In a chat or an issue: delete it. It's still out there, which is why step 1 came first.
5. **Fix the cause.** Wrap the job in a script so nobody pastes the key again, add the pre-push hook, and add the key's name to your agent's house rules.
6. **Write it down** in your project journal: what leaked, when, how, and what you changed. It's the cheapest way to never do it twice.

If a repo was public even briefly while it held a key, assume the key was copied.

## Where to go next

- docs/11: hosting on a droplet, where these scripts get used
- docs/08: the env-wipe trap that `scripts/portainer/redeploy.py` avoids
- docs/13: the Cloudflare token Caddy uses for certificates
- `prompts/14-key-safe-scripts.md`: have your agent wrap your own jobs in key-safe scripts
