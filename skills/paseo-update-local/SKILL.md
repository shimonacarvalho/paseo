---
name: paseo-update-local
description: Update Shimona's local Paseo checkout by stopping Desktop and its daemon, pulling main, rebasing local-changes, rebuilding, and restarting the daemon through launchd with keep-running-after-quit enabled. Use when asked to update this local installation, not to install a published release.
---

# Update local Paseo

This workflow belongs to `~/repos/paseo` on macOS. Creating or editing this skill does not run an update. A user request to perform this workflow authorizes its shutdown and restart; do not ask again unless the target or scope changes. If the executing agent depends on the daemon being stopped, arrange execution from an independent session before shutdown.

Read the checkout's `AGENTS.md` and [development guide](../../docs/development.md). Inspect current npm scripts before using the commands below; the checkout may have changed since this skill was written.

## 1. Record and check the installation

From `~/repos/paseo`, inspect:

```bash
git status --short --branch
git remote -v
git config --get branch.main.remote
git config --get branch.main.merge
git rev-parse local-changes
node packages/cli/dist/index.js daemon status --home "$HOME/.paseo" --json
launchctl print "gui/$(id -u)/sh.paseo.local-daemon"
plutil -p "$HOME/Library/LaunchAgents/sh.paseo.local-daemon.plist"
```

Record the original branch SHA, daemon home, configured listen address, process IDs, and whether Desktop was running and the daemon job was loaded. Require a clean working tree and the existing `local-changes` branch. Preserve uncommitted work before proceeding; do not silently stash, discard, or commit it. Do not create or switch to a replacement branch.

This installation uses `~/.paseo`. The ordinary repo dev wrappers default to `.dev/paseo-home` and port 6768, so do not use `npm run cli` or `npm run dev:server` to operate this daemon. Use this checkout's built CLI with explicit `--home`. Preserve its existing listen address rather than replacing it with a dev default.

## 2. Stop Desktop, then unload the daemon job

Quit the local Desktop instance normally if running, and verify its Electron/dev runner has exited. Desktop is launched manually; there must be no loaded `sh.paseo.dev-desktop` job. Do not kill unrelated Electron, Node, or Metro processes.

Unload the daemon job before stopping or rebuilding anything:

```bash
launchctl bootout "gui/$(id -u)/sh.paseo.local-daemon"
```

The job uses `KeepAlive: true`. Calling `daemon stop` while it is loaded would immediately restart the daemon. Booting out the job stops its foreground CLI and supervisor. If already unloaded, continue after verifying that fact. If a separately launched daemon remains, stop it with this checkout's CLI:

```bash
node packages/cli/dist/index.js daemon stop --home "$HOME/.paseo"
```

Verify shutdown using daemon status and the recorded process IDs/listener. Do not proceed while it is still running. Avoid forced termination unless graceful shutdown fails and the specific remaining process is confirmed.

## 3. Pull main and rebase local changes

Use main's configured tracking remote (currently `origin`, the user's fork). Use `upstream` instead only when the user requests upstream main; do not silently change tracking or push to either remote.

```bash
git switch main
git pull --ff-only
git switch local-changes
git rebase main
```

Resolve conflicts while preserving the purpose of the local commits. If a resolution is uncertain, stop and explain the conflict; do not skip commits or reset away local changes. A failed pull, rebase, or build is a stopping condition: keep the services down and report the state rather than launching a mixed or stale build. Record the resulting SHA and compare the rebased commits with the original SHA using `git range-diff` when needed.

## 4. Install and rebuild from this branch

```bash
npm ci
npm run build:server
npm run build:app-deps
npm run build:main --workspace=@getpaseo/desktop
```

These rebuild the daemon, CLI, shared app dependencies, and Electron main process. Desktop dev serves the renderer through its own dev launcher. The Alfred shortcut `/Applications/Paseo Dev.app` contains no bundled application code and does not need rebuilding after a normal checkout update. Its executable, `Contents/MacOS/launch`, runs this checkout's `packages/desktop/scripts/dev.sh`, which rebuilds Electron's main process on each launch and starts Metro for the current renderer. That startup build does not replace the daemon and shared-dependency builds above. Use the documented `build:desktop` flow only if a packaged desktop artifact is requested. Run the checks required by the current repo instructions; never run the full local test suite.

## 5. Persist keep-running-after-quit

While Desktop is stopped, update `.dev/user-data/desktop-settings.json` to set `settings.daemon.keepRunningAfterQuit` to `true`. Preserve every other field, including migration flags, and back up the settings file before changing it. Confirm this path against the launch log's `userData` path or the checkout's `packages/desktop/scripts/dev-runtime.mjs` if runtime configuration has changed. Do not modify the packaged app's settings by mistake.

The settings store caches its document in memory: changing the JSON while Desktop is running does not reliably apply the preference. Set it before relaunch, or use the running app's settings control instead.

## 6. Start the daemon through launchd and verify

The job at `~/Library/LaunchAgents/sh.paseo.local-daemon.plist` runs this checkout's built CLI in the foreground:

```text
<absolute-node-path> /Users/shimona/repos/paseo/packages/cli/dist/index.js daemon run --home /Users/shimona/.paseo
```

It uses the repo as its working directory, a login shell for the provider environment, `RunAtLoad: true`, `KeepAlive: true`, and a 30-second restart throttle. Preserve its existing configuration. The absolute Node path must exist; update it if the Node installation changed. Do not use `daemon start` in this job: that command detaches, leaving launchd supervising an exited launcher.

From the `local-changes` branch, after all builds succeed:

```bash
plutil -lint "$HOME/Library/LaunchAgents/sh.paseo.local-daemon.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/sh.paseo.local-daemon.plist"
launchctl print "gui/$(id -u)/sh.paseo.local-daemon"
node packages/cli/dist/index.js daemon status --home "$HOME/.paseo" --json
```

Require a running launchd job, `localDaemon: running`, `connectedDaemon: reachable`, the recorded home/listen address, and `desktopManaged: false`. Inspect the CLI/supervisor/worker process paths to confirm that they use this checkout, not a global npm installation or `/Applications/Paseo.app`. Report the branch and SHA used for the rebuild; a version number alone does not establish source provenance.

Leave Desktop closed unless it was previously open or the user requests it. If reopening it, use the installed Alfred shortcut:

```bash
open "/Applications/Paseo Dev.app"
```

Before using the shortcut after an update, inspect `Contents/MacOS/launch`. It currently pins the checkout path, the Node directory in `PATH`, `PASEO_HOME`, and the daemon endpoint through `PASEO_DEV_DAEMON_ENDPOINT` and `PASEO_LISTEN`. Preserve these when unchanged; update the launcher only if the Node installation, checkout location, daemon home/listen address, or repo startup interface changed. Match the daemon address recorded in step 1 rather than substituting port 6768. The shortcut logs to `~/Library/Logs/Paseo Dev/launcher.log` and uses the checkout's `.dev/user-data` profile. Verify that the desktop connects to the existing daemon. If the shortcut is missing, launch the repo's desktop dev script through a durable launcher with the same explicit home and recorded daemon endpoint. Do not restore or create a Desktop launchd job. Keep `keepRunningAfterQuit` enabled as documented above.

On this Apple Silicon Mac, preserve the shortcut's explicit ARM64 launch:

```bash
exec /usr/bin/arch -arm64 /bin/bash ./packages/desktop/scripts/dev.sh
```

Without it, LaunchServices can pass an Intel architecture preference through the shell launcher: Electron itself reports `arm64`, but its universal `sysctl` subprocess runs under Rosetta and incorrectly triggers Paseo's Intel-build warning. Verify the actual Electron binary and startup architecture before replacing it with a downloaded build.

The daemon must remain reachable with Desktop closed. launchd owns its lifecycle and restarts it if it exits. This is a user LaunchAgent: it starts at login and does not provide a service before login. Inspect `~/.paseo/launchd-daemon.log` and `~/.paseo/daemon.log` for startup failures. Do not claim success from the launchd job's state alone.
