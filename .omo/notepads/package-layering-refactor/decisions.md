## [2026-05-20T15:12:12Z] Task 2 scope reduction
Dropped `write-file-atomically.ts` from utils extraction.
Reason: depends on omo-specific `tolerant-fsync` chain (classify-path-environment, fsync-skip-tracker, logger).
Decision deferred to a future task.
Net effect: utils package ships 12 files instead of 13.

## [2026-05-20T15:12:12Z] Task 2 jsonc-parser decoupling
Choice: Option A
Reason: Small call-site surface; keeps full jsonc-parser API together in the new package and avoids split ownership.
Call sites changed: src/plugin-config.ts, src/cli/config-manager/config-context.ts, src/cli/doctor/checks/config.ts, src/cli/doctor/checks/model-resolution-config.ts, src/cli/doctor/checks/team-mode.ts, src/cli/doctor/checks/tools-lsp.ts, src/shared/project-discovery-dirs.ts, packages/utils/src/jsonc-parser.test.ts, packages/utils/src/jsonc-parser.memoization.test.ts
