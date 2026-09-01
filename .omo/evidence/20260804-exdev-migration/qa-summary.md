# QA evidence: issue #6574 EXDEV config migration

Date: 2026-08-04
Worktree: `.local-ignore/worktrees/fix-6574-exdev-migration`
Base: `origin/dev` at `1a42d2cdca9f266e28810381dedf6b133b6ff148`

## Root cause

The migration transaction moved each consumed legacy config into its backup tree with `renameSync` in two paths: normal plan execution and pending-journal recovery. POSIX rename cannot cross filesystem boundaries. A Docker bind mount for `~/.config/opencode` and the container filesystem for `~/.omo` therefore produced `EXDEV` after the unified target had been written, left `.migration-journal.json` pending, and retried the same impossible rename on every startup.

The startup result recorded the error through the debug file logger and attempted a TUI toast when that API existed, but there was no non-debug terminal warning for headless/server startup or clients without the toast API.

## What was tested and observed

### Failing-first regression proof

Command:

```sh
bun test packages/omo-opencode/src/startup-migration.test.ts packages/omo-opencode/src/testing/create-plugin-module.test.ts
```

- `red.txt` is the initial pre-production-change run: 16 passed, 3 failed. Both fresh and recovery backup moves returned `EXDEV`, and no `console.warn` was emitted.
- `negative-control-red.txt` removes the production fallback and warning from the final source while retaining the finalized tests. It proves the exact reported state where the journal has `targetWritten: true`: 17 passed, 3 failed for fresh EXDEV, target-recorded journal recovery EXDEV, and the missing visible warning.

Why enough: the failures are behavioral assertions at the OpenCode startup migration boundary, not prompt or implementation snapshots. The recovery test explicitly reads the journal and asserts `targetWritten === true` before the failing resume.

### Automated GREEN gate

Command:

```sh
bun test packages/omo-config-core/src/migration \
  packages/omo-opencode/src/startup-migration.test.ts \
  packages/omo-opencode/src/testing/create-plugin-module.test.ts
```

Observed in `touched-scope-tests.txt`: 46 passed, 0 failed, exit 0. Coverage includes:

- fresh backup rename `EXDEV` falls back to copy plus unlink;
- a target-recorded pending journal resumes across `EXDEV`;
- non-`EXDEV` rename errors remain failures and preserve the source;
- migration failures emit the new warning and retain the existing error toast;
- the full shared migration transaction, lock, predicate, merge, and recovery suites remain green.

### Typecheck and build

- `typecheck.txt`: `bun run typecheck`, exit 0 across root, scripts, and all package tsconfigs.
- `build.txt`: `bun run build`, exit 0. Generated tracked artifacts were restored after the build so they are not part of this patch.
- Language-server diagnostics reported no findings for four changed files; two OpenCode files timed out waiting for fresh diagnostics after 3000 ms. The package-inclusive typecheck above is the authoritative clean result for those files.

### Real OpenCode / Docker bind-mount QA

Driver: `real-opencode-cross-device-qa.sh`

Surface driven: released OpenCode 1.17.7 `serve`, loading this worktree's bundled local plugin (`dist/index.js`) in disposable `omo-qa` containers. The script requested `/session?directory=...` to force real instance/plugin initialization.

Success case:

- `success-devices.txt` records different Linux device ids for the legacy source (`37`) and `~/.omo` (`63`), proving an actual cross-filesystem boundary.
- `success-health.json` records a healthy real OpenCode server.
- `success-omo.jsonc` shows the legacy Oracle model in the unified `[opencode]` config plus migration markers.
- `success-backup.json` contains the original legacy document.
- `success-observed.txt` records `legacy_exists=no`, `journal_exists=no`, and the real timestamped backup path.

Visible-warning case:

- The legacy file was a nested read-only bind mount while the containing OpenCode config directory remained writable, allowing OpenCode itself to initialize while forcing the fallback unlink to fail with `EBUSY`.
- `warning-health.json` records a healthy real server.
- `warning-warning.txt` captures the non-debug terminal warning: legacy configuration changes were not applied.
- `warning-observed.txt` records that the legacy source and journal remain, which is expected when the backup move cannot complete.

Isolation:

- `opencode-qa-self-check.txt` records the skill harness dependency and sandbox self-check passing.
- `real-db-before.txt`, `real-db-after.txt`, and `isolation.txt` record the host OpenCode session count unchanged at 21941 before and after Docker QA.
- Containers were disposable and did not mount the host OpenCode data directory.

Why enough: this combines deterministic transaction-level tests for both execution paths with a real kernel/device-boundary reproduction through the actual OpenCode startup surface. The negative failure case proves the warning outside the debug logger and without relying on TUI rendering.

## What was omitted

- No provider prompt was sent because config migration runs during instance/plugin initialization and does not require a model call. The real `/session` list request forces the same startup path without creating a conversation.
- TUI smoke was omitted because no TUI code or toast behavior changed; the existing error-toast assertion remains green. The new requirement is specifically a non-debug warning, proven in real `opencode serve` output.
- Raw host environment variables, credentials, auth stores, tokens, and headers were not captured. The fixture used only a synthetic model string and local file paths.
- Full root `bun test` was not run locally; the migration package and affected OpenCode startup suite were run together, while full typecheck and build passed. PR CI supplies the repository-wide test matrix.

## Residual risk

The fallback is synchronous copy plus unlink, matching the existing injected filesystem contract and preserving non-`EXDEV` behavior. If copying succeeds but unlinking fails, startup now emits the visible warning and leaves the journal pending; this pre-existing failure semantics is intentionally retained rather than broadening the patch into transaction rollback policy. The real warning case covers that user-visible residual.
