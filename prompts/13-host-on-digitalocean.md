# 13 · Host it on DigitalOcean

**Use it when:** the app builds into a Docker image (prompt 10) and people outside your network need to reach it, without depending on your office internet.
**Fill in:** `<app-image>` (for example `ghcr.io/<owner>/<app>:latest`), `<record>` and `<your-domain>` (for example `maps` and `example.com`), `<region>` (for example `nyc3`), `<size>` (for example `s-1vcpu-1gb`), and whether DigitalOcean hosts your DNS (`MANAGE_DNS=yes` or `no`).
**Read first:** `docs/playbook/11-where-to-run-it.md` (all of it), `docs/playbook/12-keys-and-scripts.md` sections 3 and 4, and `docs/playbook/13-https-with-caddy.md`.

Before you start, do these yourself, not the agent: create the DigitalOcean API token (custom scopes, with an expiry), save it in `secrets/do.env` or the Keychain, and upload your laptop's SSH public key to the account.

```text
Goal
Put this app on one DigitalOcean droplet, reachable at https://<record>.<your-domain>, using the scripts in
scripts/do/ (copy them from the playbook's scripts/ folder if this repo doesn't have them yet, keeping
scripts/lib/ next to them). Read docs/playbook/11-where-to-run-it.md and sections 3 and 4 of
docs/playbook/12-keys-and-scripts.md first. You never see the API token: the scripts read it from
secrets/do.env or the macOS Keychain.

Steps
1. Check the setup without reading any secret:
   - scripts/lib/load-env.sh --check --file secrets/do.env DIGITALOCEAN_ACCESS_TOKEN SSH_KEY_NAME
     (it prints names and lengths only). If something is missing, stop and tell me what to add.
   - .gitignore has /secrets/ and *.env; .dockerignore has secrets and *.env.
2. Set the non-secret settings for this app (in secrets/do.env next to the token, or as flags):
   APP_IMAGE=<app-image>  DOMAIN=<your-domain>  RECORD=<record>  REGION=<region>  SIZE=<size>
   MANAGE_DNS=<yes|no>  RESERVED_IP=yes  BACKUPS=yes
   You may edit settings lines in secrets/do.env, but don't print the file or touch the token line.
3. If the app needs more than the example's single web container (an API, a database, secrets), adapt
   scripts/do/cloud-init.yaml: extra services, each env var as ${VAR} under environment:, no ports: on the
   database, and nothing secret in the file. Show me the diff.
   Its Caddyfile says reverse_proxy web:80, which fits the example's default nginx image. An image that
   listens on another port (the example's --target server image, or a shape-A Node app, listens on 3000)
   needs that line changed to web:<port>, or every request is a 502.
4. Run scripts/do/provision-droplet.sh --dry-run and show me the whole plan and the cost lines.
5. STOP. Wait for me to say "go". Then run scripts/do/provision-droplet.sh --yes and show me its output.
6. Wait for first boot: ssh app@<ip> cloud-init status --wait (use the ip line the script printed).
   For the first few minutes, "Connection refused" or "Permission denied (publickey)" is normal: the
   user app only gets your keys partway through setup. Wait a minute and retry; don't touch the keys.
7. If MANAGE_DNS=no, tell me the exact A record to add and wait until I say it's done.
8. If the app has secrets, follow "Secrets onto the box" in docs/11: I run the command that streams
   secrets/app.prod.env over SSH, or you run it without printing the file. Then docker compose up -d.
9. Verify (see below).

Constraints
- Never ask me to paste the token. Never cat, grep or print secrets/*.env, and never set -x.
- Never put a secret in cloud-init user data, a command line, a URL, a commit or the image.
- --dry-run first, always. --yes only after I've said go in this session. Ask again before anything
  that deletes or re-creates a droplet, a reserved IP or a DNS record.
- Firewall: 22, 80 and 443 in, nothing else. No database ports: published Docker ports go around ufw.
- If provision-droplet.sh says I don't hold the SSH key's private half, stop. Don't work around it.
- On macOS, don't use `timeout` (it doesn't exist). Use check-health.sh, curl --max-time, or nc -z -G 5.
- Long jobs over SSH run detached (nohup ... &) with a log you tail, not in the foreground.
- If something fails, read the error before retrying. A 502 means Caddy works and the app doesn't.
- Don't destroy anything you didn't create in this session.

Acceptance checks
- provision-droplet.sh printed droplet_id=... and ip=..., and its plan matched what I approved.
- scripts/do/provision-droplet.sh --check reports every line ok: droplet, tag, reserved IP assigned,
  firewall covers the droplet via the tag, public DNS points at the reserved IP.
- scripts/do/check-health.sh https://<record>.<your-domain> says HEALTHY, with the commit CI built
  (pass --expect-commit when /health reports commit_sha).
- From outside the droplet: curl -sI http://<record>.<your-domain> redirects to https, and the certificate
  is valid (curl -sI https://<record>.<your-domain> without -k).
- ssh root@<ip> is refused, ssh app@<ip> works, and a password login is refused.
- On the droplet: sudo ufw status shows only 22, 80 and 443; docker compose ps shows every service up;
  /etc/docker/daemon.json has log rotation.
- Nothing secret in the repo: scripts/secrets/scan-before-push.sh --env-file secrets/do.env is clean.

How to verify (show me)
- The dry-run plan, and the real run's output.
- The --check output and the check-health.sh line.
- The certificate issuer and expiry: curl -svI https://<record>.<your-domain> 2>&1 | grep -E 'issuer|expire'
- The scan summary line.
- The monthly cost the script showed, and a reminder of how to tear it all down:
  scripts/do/destroy-droplet.sh --dry-run
```

## Tearing down a test droplet

Ask for it explicitly, in a new message: "Run `scripts/do/destroy-droplet.sh --dry-run`, show me the list, then wait." Run the real command yourself, because it asks you to type the droplet name. Then check the control panel for leftover reserved IPs and snapshots.

**If your DNS isn't at DigitalOcean (`MANAGE_DNS=no`, the default), delete the A record yourself, at your DNS host, the moment the droplet is gone.** The script only deletes records it manages, and it prints a WARN line naming the record. A record left pointing at a released IP is a takeover risk: DigitalOcean can give that address to another customer, who could then serve pages, and get a valid certificate, for your hostname.
