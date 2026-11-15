---
name: paseo-update-local
description: Update Shimona's local Paseo checkout at ~/repos/paseo on macOS by quitting Desktop, unloading the launchd daemon, fast-forwarding main to upstream/main, rebasing local-changes, rebuilding, restarting the daemon through launchd, and pushing both branches to the fork. Use when asked to update this local installation, not to install a published release.
---

# Update local Paseo

Target: `~/repos/paseo` on this Apple Silicon Mac. Run every command from there.

Editing this file is not an update. A request to update authorizes the shutdown and restart below; do not ask again — but read step 0 first.

Read `AGENTS.md` and the [development guide](../../docs/development.md). Re-check the npm scripts named in step 4; the checkout may have changed since this was written.

## Topology

```text
upstream/main  getpaseo/paseo — where updates come from
      │
      ├──► main (local, tracks origin/main) ──rebase──► local-changes ──► origin/local-changes (backup)
      │
      └──► origin/main  the fork's mirror, only as fresh as the last `git push origin main`
```

Your commits never live on `main`. `main` is always a fast-forward copy of `upstream/main`, so it can never conflict and never needs a force-push. `local-changes` is `main` plus the local commits and is rewritten by every update, which is why it is pushed with `--force-with-lease` and never opened as a pull request.

## 0. Confirm this agent is not owned by the daemon

Stopping the daemon kills every agent it manages, including this session if it is one. Walk the parent chain:

```bash
ps -o pid,ppid,command -p $$
P=$(ps -o ppid= -p $$ | tr -d ' '); for i in 1 2 3 4 5 6; do ps -o pid,ppid,command -p "$P" | tail -1; P=$(ps -o ppid= -p "$P" | tr -d ' '); [ -z "$P" ] && break; done
```

If anything in that chain is `packages/cli/dist/index.js daemon run`, `Paseo Supervisor`, or `Paseo Daemon`, stop and hand the work to an independent session (a terminal, or an agent run by a different harness). A chain that ends at `launchd` is independent. Cross-check with `node packages/cli/dist/index.js ls --home "$HOME/.paseo"`: a session Paseo manages appears there.

## 1. Record the installation before touching anything

```bash
git fetch origin --prune
git fetch upstream --prune
git status --short --branch
git remote -v
git config --get branch.main.remote
git config --get branch.local-changes.remote
git rev-parse --short main origin/main upstream/main local-changes
git rev-list --count local-changes..upstream/main
git rev-list --count upstream/main..local-changes
git log --oneline --no-decorate main..local-changes
node packages/cli/dist/index.js daemon status --home "$HOME/.paseo" --json
launchctl print "gui/$(id -u)/sh.paseo.local-daemon" | head -20
plutil -p "$HOME/Library/LaunchAgents/sh.paseo.local-daemon.plist"
ps -Ao pid,command | grep -E 'desktop/scripts/dev-runner.mjs|electron/dist/Electron.app/Contents/MacOS/Electron|expo start --port 8082' | grep -v grep
```

Record: old `main` SHA (the range-diff base), old `local-changes` SHA, the local commit list, daemon home, configured listen address, process IDs, whether Desktop was running, whether the job was loaded. Tell the user the behind-count; it is often 20–350 commits, which is one to eighteen days of upstream work.

Require:

- `local-changes` is checked out and has local commits (`upstream/main..local-changes` is non-empty).
- The working tree is clean. Untracked files survive a rebase untouched, but surface anything dirty and never silently commit or stash it. A new skill or doc file likely belongs in a commit on `local-changes` — ask before committing.
- Do not create or switch to a replacement branch.

Two facts about this installation:

- The daemon home is `~/.paseo` and the listen address is whatever step 1 recorded (currently `100.127.246.59:6767`). The repo dev wrappers (`npm run cli`, `npm run dev:server`) point at `.dev/paseo-home` and port 6768. Never use them to operate this daemon; use this checkout's built CLI with explicit `--home`, and keep the recorded listen address instead of substituting a dev default.
- `origin/main` is the fork mirror and can lag by hundreds of commits. Do not treat it as the update source.

## 2. Quit Desktop, then unload the daemon job

Desktop is launched by hand and has no launchd job. Quit it by bundle id, not by app name — Slack, VS Code, Claude, and Pen are Electron apps too and must not be touched:

```bash
osascript -e 'tell application id "com.github.Electron" to quit'
```

Wait a few seconds, then require empty output from:

```bash
ps -Ao pid,command | grep -E 'dev-runner.mjs|electron/dist/Electron.app/Contents/MacOS/Electron|expo start --port 8082' | grep -v grep
```

Unload the daemon job before stopping or rebuilding anything:

```bash
launchctl bootout "gui/$(id -u)/sh.paseo.local-daemon"
```

The job is `KeepAlive: true`, so `daemon stop` while it is loaded restarts the daemon immediately. Booting out stops its foreground CLI, supervisor, and worker. Confirm:

```bash
launchctl print "gui/$(id -u)/sh.paseo.local-daemon" | head -3   # "Could not find service"
node packages/cli/dist/index.js daemon status --home "$HOME/.paseo" --json   # localDaemon: stopped, pid: null
ps -Ao pid,command | grep -E 'dist/index.js daemon run|Paseo Supervisor|Paseo Daemon' | grep -v grep
```

If a separately launched daemon is still up, stop it with `node packages/cli/dist/index.js daemon stop --home "$HOME/.paseo"`. Force-kill only when graceful shutdown failed and the specific remaining process is confirmed. Do not continue while it is running.

## 3. Fast-forward main from upstream, rebase local-changes

`origin/main` is the mirror, so `git pull --ff-only` there is usually a no-op. Take upstream directly and leave the branch tracking config alone:

```bash
git switch main
git merge --ff-only upstream/main
git rev-parse --short main upstream/main   # must match
git switch local-changes
git rebase main
```

Verify the replay kept every commit unchanged in shape:

```bash
git range-diff <old-main>..<old-local-changes> main..local-changes
git log --oneline --no-decorate main..local-changes
```

Every range-diff line should start with `=`. A `!` means a commit's content changed — read the diff and decide whether the change is the correct conflict resolution or a mistake.

Conflicts: resolve so each local commit keeps its purpose, and confirm the purpose from the commit's own diff rather than its subject line. If a resolution is uncertain, stop and explain the conflict. Never skip a commit, never reset local work away. A failed merge, rebase, or build is a stopping condition: leave the services down and report the state instead of launching a mixed or stale build.

## 4. Rebuild

```bash
npm ci
npm run build:server
npm run build:app-deps
npm run build:main --workspace=@getpaseo/desktop
npm run typecheck
npm run lint
```

Expect several minutes total. `npm ci` deletes and reinstalls `node_modules`, so nothing may be using it.

- `build:server` — protocol/server/CLI build. The daemon runs from `packages/cli/dist` and `packages/server/dist`. It also copies `skills/` and `plugins/` into `dist`, so a committed skill or plugin change only reaches the daemon after this step.
- `build:app-deps` — highlight, client, plugin, and the expo audio module.
- `build:main` — Electron main process.
- Skip the full test suite locally; never run it. Run a single test file only if a local commit relies on one.

`/Applications/Paseo Dev.app` contains no application code. It runs this checkout's `packages/desktop/scripts/dev.sh`, which rebuilds Electron's main process and starts Metro; that is a renderer build and does not replace the daemon and shared-dependency builds above. Use `build:desktop` only when a packaged desktop artifact is requested.

## 5. Keep-running-after-quit, while Desktop is stopped

Back up `.dev/user-data/desktop-settings.json`, then make sure `settings.daemon.keepRunningAfterQuit` is `true` while preserving every other field, including migrations. The settings store caches its document in memory, so this sticks only while Desktop is stopped or through the running app's own control. Confirm the path against the launch log's `userData` or `packages/desktop/scripts/dev-runtime.mjs` if runtime layout changed. Never edit the packaged app's settings.

## 6. Start the daemon through launchd and verify

The job at `~/Library/LaunchAgents/sh.paseo.local-daemon.plist` runs this checkout's built CLI in the foreground:

```text
<absolute-node-path> /Users/shimona/repos/paseo/packages/cli/dist/index.js daemon run --home /Users/shimona/.paseo
```

Working directory is the repo, through a login shell so providers inherit their environment, with `RunAtLoad: true`, `KeepAlive: true`, and a 30-second throttle. Preserve that configuration and make sure the absolute Node path exists. It must stay `daemon run`; `daemon start` detaches and leaves launchd supervising an exited launcher.

```bash
plutil -lint "$HOME/Library/LaunchAgents/sh.paseo.local-daemon.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/sh.paseo.local-daemon.plist"
launchctl print "gui/$(id -u)/sh.paseo.local-daemon" | head -20
node packages/cli/dist/index.js daemon status --home "$HOME/.paseo" --json
```

Read status twice, a few seconds apart. The first read after bootstrap commonly returns `note: DAEMON_REQUEST_TIMEOUT` with `workerPid: null` while provider probes warm up; the second should be complete. Only a repeated failure is a failure.

Require: job `state = running`; `localDaemon: running`; `connectedDaemon: reachable`; the recorded listen address; `desktopManaged: false`; `daemonVersion` equal to the repo's `package.json` version; every provider `available: true` or reporting a named error. Then confirm the processes belong to this checkout and not a global npm install or `/Applications/Paseo.app`:

```bash
ps -Ao pid,ppid,command | grep -E 'dist/index.js daemon run|Paseo Supervisor|Paseo Daemon|terminal-worker-process' | grep -v grep
```

Report the branch and SHA used for the rebuild. A version number alone does not prove source provenance.

## 7. Reopen Desktop only if it was open before

```bash
open "/Applications/Paseo Dev.app"
```

Wait for it to come up, then require: `dev-runner.mjs` and Electron running; daemon `pid` unchanged; `desktopManaged: false`; the app actually connected to that daemon:

```bash
grep -o '"appVersion":"[^"]*"' "$HOME/.paseo/daemon.log" | sort | uniq -c | tail -3
tail -20 "$HOME/Library/Logs/Paseo Dev/launcher.log"
```

Inspect `Contents/MacOS/launch` before relying on it. It pins the checkout path, the nvm Node directory in `PATH`, `PASEO_HOME`, `PASEO_DEV_DAEMON_ENDPOINT`, and `PASEO_LISTEN`, and uses the `.dev/user-data` profile. Update it only if the Node installation, checkout location, daemon home/listen address, or repo startup interface changed; match the daemon address recorded in step 1 rather than substituting 6768.

Preserve the explicit ARM64 launch:

```bash
exec /usr/bin/arch -arm64 /bin/bash ./packages/desktop/scripts/dev.sh
```

Without it, LaunchServices can pass an Intel preference through the shell launcher: Electron reports `arm64` while its universal `sysctl` subprocess runs under Rosetta and Paseo shows a false Intel-build warning. Check the actual binary and startup architecture before reaching for a downloaded build.

Never create a Desktop launchd job. If the shortcut is missing, launch the dev script through a durable launcher with the same explicit home and recorded endpoint.

## 8. Push both branches to the fork

```bash
git push origin main
git push --force-with-lease origin local-changes
```

`main` is a plain fast-forward. If it is rejected, the fork holds commits you did not expect — stop and inspect instead of forcing.

`local-changes` needs `--force-with-lease` because the rebase rewrote every local commit's SHA. The upstream tracking ref makes the lease meaningful. If `branch.local-changes.remote` is unset, ask before setting it, then `git push -u origin local-changes`.

The fork copy is a backup for disaster recovery. Never open a pull request from it, never merge it into `main`, and never let upstream see it.

## Gotchas

- `origin/main` lagging is normal and harmless; it is only as fresh as the last push. Updates always come from `upstream/main`.
- `upstream/main` takes roughly 15–30 commits a day. Drift is expected. Update when the user wants something from it, not on a schedule.
- bootout before any stop or rebuild; with `KeepAlive`, `daemon stop` is self-defeating.
- `daemon status` can time out once right after bootstrap. Re-read before calling it broken.
- Desktop's bundle id is `com.github.Electron`. `quit app "Electron"` can match another app.
- `npm ci` wipes `node_modules`; nothing else may be running.
- Skills and plugins are served from `dist`; a skill edit needs `build:server` before the daemon sees it.
- `keepRunningAfterQuit` is read at Desktop startup; editing the JSON while Desktop runs does not apply.
- This is a user LaunchAgent: nothing serves before login. Read `~/.paseo/launchd-daemon.log` and `~/.paseo/daemon.log` before declaring success.
- Commit dates carry author timezones. Do not estimate elapsed time from them; use `date` and `git log --date=iso-strict-local`.
- If a build fails, the services stay down. Report the failing step, the log path, and the branch SHA. Do not restart into a stale `dist`.
