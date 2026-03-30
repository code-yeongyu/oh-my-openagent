# Managed install and refresh flow

## Scope

This fork keeps the live OpenCode config under `C:\Users\RedFox\.config\opencode` in sync with the repo-owned assets under `assets/custom-opencode/`.

Run the repo copy of `assets/custom-opencode/refresh-omo.ps1`. That copy owns the managed assets and can use the repo Bun sync entry point when Bun is available.

## Prerequisites

- OpenCode is already installed and `opencode --version` works.
- The target config directory already exists and has a `package.json`. The current default target is `C:\Users\RedFox\.config\opencode`.
- `node` and `npm` are on `PATH`.
- `oh-my-opencode` is installed in the target config directory. The refresh script prefers target-local doctor entry points (`<target>\node_modules\.bin\oh-my-opencode*` first, then the package `bin\oh-my-opencode.js` via Node) and only falls back to a global `oh-my-opencode` on `PATH` if the target-local entry points are unavailable.
- Bun is optional for the refresh script itself. If Bun is available from the repo checkout, the script runs `script/sync-custom-opencode-assets.ts`. If Bun is missing, the script falls back to a PowerShell sync path that writes the same `.oh-my-openagent-sync` manifest, log, and per-file backups.

## What gets synced

The managed refresh copies these repo-owned assets into the target config directory:

- `opencode.json`
- `oh-my-opencode.json`
- `refresh-omo.ps1`
- `plugins/*.js`

That keeps the host config, the plugin config, the wrapper loader, the custom heartbeat plugin, the TLS retry plugin, and the refresh script itself under version control.

## Run the managed refresh

From the repo root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\assets\custom-opencode\refresh-omo.ps1"
```

To point at a different OpenCode config directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\assets\custom-opencode\refresh-omo.ps1" -TargetDir "C:\path\to\other\opencode"
```

For a rollback drill or a temporary asset override, point the script at a different asset tree:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\assets\custom-opencode\refresh-omo.ps1" -AssetRoot "C:\temp\broken-assets" -CheckOnly
```

`-CheckOnly` keeps the dependency install step out of the way while still exercising sync, validation, and rollback.

## What the script does

1. Verifies `node`, `npm`, and `opencode`, then resolves `oh-my-opencode` from the target config directory first (`node_modules\.bin` shims, then the package `bin\oh-my-opencode.js` via Node) before considering a global `PATH` entry.
2. Creates a full pre-refresh backup of the target config surface before any managed files are replaced.
3. Runs `npm install` if the target has no `node_modules`, otherwise runs `npm update oh-my-openagent @code-yeongyu/comment-checker` inside the target config directory.
4. Repairs the local Windows platform binary package for `oh-my-opencode` when it is missing, so the target-local doctor command can run from the target `node_modules` tree.
5. Syncs the managed assets into the target directory.
6. Runs these live checks against the target directory by setting `OPENCODE_CONFIG_DIR` for the command invocation:
   - `opencode --version`
   - `opencode debug config`
   - `oh-my-opencode doctor --json`
7. Accepts refresh completion when doctor reports only these already-documented advisory caveats: the wrapper-file registration false negative from older installed doctor logic, missing `gh`, and missing `@code-yeongyu/comment-checker`.
8. If any other post-backup step fails, restores the previous target contents automatically and then re-runs `opencode debug config` against the restored target.

## Where backups, manifests, and logs go

Inside the target config directory:

- `.oh-my-openagent-refresh/backups/<run-id>/` stores the pre-refresh backup used for rollback.
- `.oh-my-openagent-refresh/logs/<run-id>.log` stores the refresh run log.
- `.oh-my-openagent-sync/manifest.json` stores the latest managed sync manifest.
- `.oh-my-openagent-sync/sync.log` stores the latest sync log.
- `.oh-my-openagent-sync/backups/<run-id>/` stores the per-file backups created by the asset sync when an existing managed file is overwritten.

The refresh backup is broader than the sync backup. It captures the target config surface before the refresh starts. The sync backup is narrower and only stores files that the managed asset copy replaced during that run.

## Manual restore

If you need to restore manually, copy the latest refresh backup back into the target directory and leave `node_modules` in place:

```powershell
$target = "C:\Users\RedFox\.config\opencode"
$backup = Get-ChildItem -LiteralPath (Join-Path $target ".oh-my-openagent-refresh\backups") | Sort-Object Name -Descending | Select-Object -First 1
Get-ChildItem -LiteralPath $target -Force | Where-Object { $_.Name -notin @("node_modules", ".oh-my-openagent-refresh") } | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $backup.FullName -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $target $_.Name) -Recurse -Force
}
```

If you want the dependency tree to match the restored `package.json` and `package-lock.json` exactly, run `npm install` inside the target directory after the file restore finishes.

## Validation commands

Run the repo validation first:

```powershell
bun test
bun test src/cli/doctor/checks/custom-opencode-assets.test.ts src/cli/doctor/checks/custom-opencode-config.test.ts src/cli/doctor/checks/custom-opencode-refresh.test.ts src/custom-opencode/config-precedence.test.ts src/custom-opencode/alias-compatibility.test.ts src/custom-opencode/plugin-loading.test.ts --bail
tsc --noEmit
bun run build
```

Then run the live managed refresh and inspect the target state:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\assets\custom-opencode\refresh-omo.ps1"
opencode debug config
oh-my-opencode doctor --verbose
```

Current validation caveats:

- `opencode debug config` is the ground-truth check for the managed wrapper flow. It shows whether the synced config and plugin files are actually active.
- The refresh script now parses `oh-my-opencode doctor --json` and will still complete if the only reported issues are the currently documented advisory caveats: missing `gh`, missing `@code-yeongyu/comment-checker`, or the old wrapper-file registration false negative (`oh-my-openagent is not registered`).
- Any other doctor failure remains fatal and still triggers rollback.

For a rollback smoke check, copy `assets/custom-opencode/` to a temporary folder, break `oh-my-opencode.json` on purpose, and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\assets\custom-opencode\refresh-omo.ps1" -AssetRoot "C:\temp\broken-assets" -CheckOnly
```

That run should fail, restore the previous target from `.oh-my-openagent-refresh/backups/<run-id>/`, and record the restore in the refresh log.
