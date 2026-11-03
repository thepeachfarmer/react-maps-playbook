# 12 · Review and verify

**Use it when:** before merging something big, before making a repo public, or whenever something feels off. The agent only reads, runs and reports. It changes nothing unless you ask.
**Fill in:** `<scope>` (the whole repo, or "the changes on this branch compared to main").
**Read first:** `docs/playbook/10-lessons-learned.md`, plus whichever docs match the scope.

```text
Goal
Review <scope> against the playbook in docs/playbook/ and report what's wrong, ranked by how bad it is.
This is a READ-ONLY pass: don't edit tracked files, commit, push or deploy. The only files you write are
the report and the screenshots in outbox/, plus throwaway helpers in a temp dir. Read
docs/playbook/10-lessons-learned.md first. For each finding give: severity (high / medium / low), file and line, what breaks and for whom,
and the fix in one or two sentences.

Check these, in order

1. Secrets and privacy (blocking if anything is found)
   - Scan the working tree AND the full git history with gitleaks or trufflehog (install one if needed;
     say which). Also search for: .env files, private keys, "password", "secret", "token", "apikey",
     internal IP ranges (10., 172.16-31., 192.168.), real-looking hostnames, email addresses, phone numbers.
   - Real share tokens in code or docs (anything that isn't an obvious placeholder).
   - Real data in fixtures, sample files, screenshots or the Docker build context.
   - .gitignore covers .env, .env.*, *.env, /secrets/ (anchored), inbox/ and outbox/ (screenshots of the
     real app land there); .dockerignore covers .env, .env.*, *.env, secrets, .git, inbox and outbox.
     Prove it: git check-ignore -q outbox/x.png and secrets/x.env succeed, and
     git check-ignore -q scripts/secrets/scan-before-push.sh fails.
   - Print only file names and line numbers for anything secret-looking, never the value itself.
2. Auth and access
   - The fail-closed startup check exists and runs before the server listens: assertAuthConfig() (a
     prompt-11 app, JWT_SECRET) or loadConfig() as in example/server/config.js (a prompt-16 app,
     SESSION_SECRET). In production with OIDC off it refuses to start; authenticate returns 503 if it
     somehow does; the dev bypass is impossible in production. DEFAULT_ROLE unset means no access.
   - Compose: every secret uses ${VAR:?}; no secret has a :- default; no env_file.
   - Mount order: /health and /api/about are public; everything else is behind authenticate; writes check
     requireRole on the server.
   - Share routes use Object.hasOwn, read static files only, whitelist assets, and send noindex and no-cache.
   - next/return paths are validated; no open redirect.
   - trust proxy is set; cookies are HttpOnly, SameSite and Secure in production.
3. HTML injection
   - Every divIcon html, string bindTooltip/bindPopup and innerHTML goes through esc(). List any that don't.
4. Layering
   - Every dropdown, menu and popover in the chrome is portaled to document.body at 9998/9999.
   - Drawers are above 1000. The z-index ladder comment exists and matches the code.
   - Modals opened from inside the map tree are portaled or stop touch propagation.
5. Map correctness
   - getPane() || createPane(); decorative panes are pointer-events:none.
   - <GeoJSON> keys change when the data changes.
   - FitBounds doesn't re-run on polls.
   - Missing or (0,0) coordinates are filtered.
   - [lng,lat] vs [lat,lng] is handled at every boundary.
   - Timestamps carry a time zone, and "days since" uses local calendar days.
   - Polling stops when hidden and backs off on errors; WebSockets have resume, heartbeat and watchdog.
6. Mobile
   - Run scripts/shots.mjs if the repo has it. If it doesn't, create it from
     docs/playbook/09-mobile-first.md section 8 in a temp dir or outbox/ (not in the repo, since this
     pass is read-only) and run it at 320x568, 390x844, 844x390 and 1280x800 on every page. Report any horizontal scroll, clipped UI, targets under 44px, or UI
     under the notch.
7. Caching
   - The service worker never touches /api/* or cross-origin requests, and doesn't precache index.html in an
     online app.
   - sw.js is served no-cache. hardReset exists and uses location.replace with ?_hardReset.
   - A boot watchdog and an error boundary exist.
8. Build and deploy
   - Type check and build pass. docker build passes, including --no-cache --target for each build stage.
   - The compose file is image-only (no build:). The workflow has packages: write and fetch-depth 0.
   - /health returns 200 with version, commit_sha, built_at and started_at.
9. Data tools (if any)
   - Run with python3 -I; read zips in memory; the UNREADABLE tuple is used; self-checks exit 1 on failure;
     two runs give identical output (compare shasum).

Output
- A report in outbox/review-<YYYY-MM-DD>.md: a summary (blocking, should-fix, nice-to-have), then the
  findings table, then "what I could not check and why".
- Screenshots from step 6 in outbox/review-<YYYY-MM-DD>/.
- Then stop and wait. I'll tell you which findings to fix.

Constraints
- Read-only. No edits to tracked files, no commits, pushes, deploys or redeploys, no Portainer or cloud API
  calls, nothing that costs money. Ask before you install a scanner.
- Never print a secret value, a token or an env file's contents. Name the file and line only.
- Don't open secrets/ or any *.env file other than *.env.example. Use scripts/lib/load-env.sh --check.

Acceptance checks
- Every finding has a severity, a file:line (or a URL and the exact command for live checks), what breaks
  and for whom, and a one- or two-sentence fix.
- Every section 1-9 above appears in the report, with "nothing found" or "not applicable" where that's
  the answer, and section 1 says which scanner ran and over what (tree, history, or both).
- git status --porcelain is empty afterwards: the report and screenshots are in outbox/, which is ignored.
  (If outbox/ shows up there, that's a finding too.)
- No secret value appears anywhere in the report or in your messages.

How to verify (show me)
- The report's summary block, and the path of the full report.
- The scanner commands you ran and their summary lines.
- The git status --porcelain output.
- The screenshot folder's file list.
```

## Before you make a repo public

Run this prompt with `<scope>` = "the whole repo and its full git history, for publishing as a public repo". Treat every finding in section 1 as blocking. If anything secret was ever committed, don't just delete it, because it's still in the history. The simplest safe path is to start a fresh repo and copy in only what you mean to share, then rotate any credential that was ever committed.
