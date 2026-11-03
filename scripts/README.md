# scripts/: key-safe helpers for hosting and deploying

Small scripts that each do one job, read their keys at run time, and never print them. The idea behind them is explained in docs/12 ("give the agent scripts, not keys"), and the hosting steps they automate are in docs/11.

Each script has `--help`. Every script that changes something has a `--dry-run` that needs no key and makes no network calls, and it asks before it spends money or touches production (`--yes` skips the question, but only after a person has said go).

```
scripts/
├── lib/
│   ├── load-env.sh            load named keys from an env file or the macOS Keychain (bash)
│   └── load_env.py            the same, for Python scripts
├── do/                        DigitalOcean (needs doctl: brew install doctl)
│   ├── do.env.example         copy to secrets/do.env: the token plus non-secret settings
│   ├── provision-droplet.sh   droplet + SSH key check + tag + cloud-init + firewall + reserved IP + DNS
│   ├── destroy-droplet.sh     the reverse, including releasing the reserved IP
│   ├── check-health.sh        curl /health from outside, and explain what a failure means
│   ├── cloud-init.yaml        first boot: Docker, non-root user, ufw, the app behind Caddy
│   └── do-common.sh           shared helpers (sourced, not run)
├── portainer/
│   ├── portainer.env.example  copy to secrets/portainer.env
│   └── redeploy.py            pull and redeploy a Git stack, KEEPING its env, then wait for the commit
├── ci/
│   └── wait-for-build.sh      wait for GitHub Actions to finish a commit before you deploy it
└── secrets/
    ├── scan-before-push.sh    find key-shaped strings, private IPs, your env values, your denylist
    └── denylist.example.txt   copy to secrets/denylist.txt and fill in your private words
```

## Set up once

```sh
mkdir -p secrets && chmod 700 secrets
cp scripts/do/do.env.example               secrets/do.env
cp scripts/portainer/portainer.env.example secrets/portainer.env
cp scripts/secrets/denylist.example.txt    secrets/denylist.txt
chmod 600 secrets/*
"${EDITOR:-nano}" secrets/do.env      # type the real values in an editor, never on a command line
```

Your repo's `.gitignore` needs `/secrets/` and `*.env`. **Anchor `/secrets/` with the leading slash.** A bare `secrets/` also ignores `scripts/secrets/`, and the scanner silently drops out of your repo.

Prefer the macOS Keychain? Store each key there instead, then set `KEYCHAIN_SERVICE` or pass `--keychain-service` (every script takes it; `load-env.sh` and `load_env.py` also take the shorter `--service`):

```sh
security add-generic-password -U -s react-maps -a DIGITALOCEAN_ACCESS_TOKEN -w     # prompts for the value
KEYCHAIN_SERVICE=react-maps scripts/do/provision-droplet.sh --check
scripts/do/provision-droplet.sh --check --keychain-service react-maps               # the same
```

The scripts look for each key in the environment first (that's how CI secrets arrive), then the env file, then the Keychain. To check a key is there without showing it:

```sh
scripts/lib/load-env.sh --check --file secrets/do.env DIGITALOCEAN_ACCESS_TOKEN
python3 scripts/lib/load_env.py --check --file secrets/portainer.env PORTAINER_URL PORTAINER_API_KEY
```

## Common runs

```sh
# DigitalOcean (docs/11)
scripts/do/provision-droplet.sh --dry-run             # plan only; no token, no API calls
scripts/do/provision-droplet.sh                       # look, plan, show the cost, ask, create
scripts/do/provision-droplet.sh --check               # read-only: is everything in place?
scripts/do/check-health.sh https://maps.example.com --wait 600
scripts/do/check-health.sh https://maps.example.com --resolve 203.0.113.10    # before DNS points there
scripts/do/destroy-droplet.sh --dry-run
scripts/do/destroy-droplet.sh --name maps-demo        # asks you to type the name

# Own server with Portainer (docs/08, docs/11)
scripts/ci/wait-for-build.sh --sha origin/main --workflow build.yml
python3 scripts/portainer/redeploy.py --stack maps --dry-run
python3 scripts/portainer/redeploy.py --stack maps --check
python3 scripts/portainer/redeploy.py --stack maps \
  --health-url https://maps.example.com/health --expect-commit origin/main

# Before every push (docs/12)
scripts/secrets/scan-before-push.sh --env-file secrets/do.env --env-file secrets/portainer.env \
  --denylist secrets/denylist.txt
scripts/secrets/scan-before-push.sh --history ...     # before a repo goes public
```

## What each one prints

| Script | stdout | Exit code |
|---|---|---|
| `provision-droplet.sh` | `droplet_id=…` and `ip=…`, nothing else (the plan and progress go to stderr) | 0 done, 1 error or stopped |
| `destroy-droplet.sh` | `deleted_droplet_id=…`, `released_ip=…`, `deleted_firewall_id=…`. With `MANAGE_DNS=no`, a `WARN` line (stderr) naming the DNS record you must delete yourself | 0 done, 1 error or stopped |
| `check-health.sh` | one verdict line, such as `PROXY UP, APP DOWN: HTTP 502 …` | 0 healthy, 1 not, 2 bad arguments |
| `redeploy.py` | the stack, the env variable **names** it keeps, Portainer's status code, the commit seen on /health | 0 live, 1 failed or timed out |
| `wait-for-build.sh` | `run=… conclusion=… url=…` per run | 0 green, 1 not green, timed out or no run found, 2 bad arguments |
| `scan-before-push.sh` | `file:line  category  detail`, never the value | 0 clean, 1 findings, 2 bad arguments |

## Conventions (if you write your own)

- `set -euo pipefail`, and it runs on the bash 3.2 that ships with macOS: no associative arrays, no `${var,,}`, no `mapfile`, and guard empty arrays with `${a[@]+"${a[@]}"}`.
- Python scripts use the standard library only and run with `python3 -I`.
- Keys come from `lib/load-env.sh` or `lib/load_env.py`. Never from arguments, never printed, never with `set -x`.
- Commands are run with `"$@"`, never `eval`. An `eval` re-splits a quoted argument such as a multi-rule firewall string, and silently drops all but the first rule.
- Timeouts come from the tool itself (`curl --max-time`, `nc -G`) or a polling loop, because macOS has no `timeout`.
- Results go to stdout and progress to stderr, so `out=$(script …)` gets clean values.

## Testing them without spending money

Every `--dry-run` works with fake env files and no network. To exercise the real code paths offline, put a fake `doctl` or `gh` first on your `PATH` that returns canned JSON. That's how these scripts were tested, along with a local fake Portainer server, so no real API was called.
