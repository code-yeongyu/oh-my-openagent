# Parent `.omo` Symlink Writer Repair Evidence

## What Was Tested

- Red-first focused security test:
  `bun test packages/omo-config-core/src/writer/writer-security.test.ts --bail`
- Green focused writer/security tests:
  `bun test packages/omo-config-core/src/writer/writer.test.ts packages/omo-config-core/src/writer/writer-security.test.ts --bail`
- Package gate:
  `bun test packages/omo-config-core --bail`
- Category drift guard:
  `bun test tests/omo-config-category-drift.test.ts --bail`
- Typecheck:
  `bun run typecheck`
- Whitespace check:
  `git diff --check code-yeongyu/senpi-task-w0-config-schema...HEAD`
- Static scans:
  no `as any`, no TS suppressions, no empty catch blocks in writer sources, plus pure LOC counts.
- Manual public API probe:
  `bun .omo/evidence/senpi-task/task-2-config-loader-writer/manual-parent-dir-symlink-20260706.mjs`

## What Was Observed

- `red-parent-dir-symlink-20260706.txt`: failed before the fix because `updateOmoConfig` did not throw for symlinked `<project>/.omo`.
- `green-parent-dir-symlink-20260706.txt`: focused security suite passed after the fix.
- `focused-writer-security-parent-dir-symlink-20260706.txt`: 10 writer/security tests passed.
- `bun-test-omo-config-core-parent-dir-symlink-20260706.txt`: 17 package tests passed.
- `category-drift-parent-dir-symlink-20260706.txt`: category drift guard passed.
- `typecheck-parent-dir-symlink-20260706.txt`: full repo typecheck passed.
- `diff-check-parent-dir-symlink-20260706.txt`: empty output with status 0.
- `static-scan-parent-dir-symlink-20260706.txt`: no escape hatches or empty catch blocks; changed files remain under 250 pure LOC.
- `manual-parent-dir-symlink-20260706.txt`: symlinked project `.omo` was rejected with `OmoConfigWriteError`; target global fixture config stayed unchanged; no backup was created in the symlink target; a normal project write succeeded; cleanup removed the temp fixture root.

## Why It Is Enough

The test and manual probe both drive the project-scope writer through the public `updateOmoConfig` surface with `<project>/.omo` pointing at a fixture user/global config directory. They prove the exploit no longer mutates or backs up the target while preserving normal project writes and existing user/project writer behavior.

## What Was Omitted

No OpenCode or Codex harness QA was run because the change is confined to harness-neutral `packages/omo-config-core/**`. No secret-bearing logs, environment dumps, auth headers, or private credentials were copied into evidence.
