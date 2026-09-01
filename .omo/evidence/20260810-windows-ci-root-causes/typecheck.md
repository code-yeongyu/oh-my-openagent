# Root typecheck gate

## Initial workstation-toolchain result

The first run used local Bun 1.4.0 / Node 26 and failed in unchanged code with missing workspace type entries plus a Senpi factory cast mismatch. The same commit's GitHub typecheck jobs were green on Linux, macOS, and Windows.

That result was classified as environment drift, not suppressed or attributed to this patch.

## CI-pinned reproduction

```bash
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/fix/windows-ci-root-causes
npx --yes bun@1.3.12 install --frozen-lockfile --ignore-scripts
npx --yes bun@1.3.12 run typecheck
```

Observed:

```text
bun install v1.3.12 (700fc117)
$ tsgo --noEmit && bun run typecheck:script && bun run typecheck:packages
$ tsgo --noEmit -p script/tsconfig.json
$ tsgo --noEmit -p packages/.../tsconfig.json
PINNED_TYPECHECK_DONE exit=0
```

Versions:

```text
Bun 1.3.12
tsgo 7.0.0-dev.20260518.1
```

## Why this is enough

This exactly matches the CI Bun version and frozen, scripts-disabled install path used by the `typecheck` matrix. It validates root, script, and all package TypeScript projects without changing source or suppressing diagnostics.

## Cleanup receipt

The monitor exited 0. The install changed only ignored dependency state; Git status contains only the four intended task source files.
