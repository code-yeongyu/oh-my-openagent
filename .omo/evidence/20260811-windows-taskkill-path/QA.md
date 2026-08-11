# Windows taskkill PATH QA

## Scope

Verify that the omo-native launcher restores Windows System32 when the inherited
PATH omits it, preserves the inherited PATH key casing, keeps the Senpi shim
first, and does not duplicate an equivalent mixed-separator shim entry.

## Red/green regression

- Red command:
  `bun test packages/omo-native/test/launcher.test.ts --test-name-pattern 'restores System32|promotes an existing shim'`
- Red observation after temporarily restoring the pre-fix launcher logic:
  0 pass, 2 fail. System32 was absent and the equivalent mixed-separator shim
  appeared twice.
- Green command: the same command after restoring the fix.
- Green observation: 2 pass, 0 fail.

## Automated checks

- `bun test packages/omo-native/test/launcher.test.ts`
  - 28 pass, 1 platform skip, 0 fail.
- `bun run typecheck`
  - Exit 0 across root, script, and package TypeScript projects.
- `bun install --frozen-lockfile`
  - Exit 0; postinstall completed the repository build and omo-native staging.

## Manual CLI QA

A standalone temporary driver copied the real `packages/omo-native/bin`
launcher into a fake installed package, supplied one mixed-separator Senpi shim,
removed every inherited PATH key, and set `Path` to a directory without
System32. It then drove the launcher through the matching CLI surface.

Observed:

| Path | Status | Child argv | PATH observation |
|---|---:|---|---|
| Happy (`say hi`) | 0 | packaged extension, then `say hi` | `Path` preserved; shim first; System32 present |
| Bad input (`--bad-input`) | 2 | packaged extension, then bad input | status propagated; shim first; System32 present |
| Help (`--help`) | 0 | packaged extension, then `--help` | help output observed; shim first; System32 present |

The temporary driver and its fixture directory were removed after the run.

## Residual

Running the source worktree against the full real Senpi dependency with root
commands such as `--help` did not terminate within 30 seconds. The fake-package
driver was used because it isolates the launcher contract changed by this PR
while still executing the real launcher files. The non-terminating real Senpi
root command was not changed because it is outside this PATH fix.
