# CodeGraph 1.5.0 bump evidence

## Changed

- Pinned the component optional dependency and provisioning manifest to CodeGraph 1.5.0.
- Added version-aware managed-runtime selection so stale 1.0.1/1.4.1 installs re-provision before use.
- Regenerated the npm lockfile and committed CodeGraph component bundles; refreshed tests, notices, and docs.

## Verified

- npm reports 1.5.0 as latest; GitHub release metadata/release notes were reviewed.
- All six darwin/linux GitHub and win32 npm assets return HTTP 200, and downloaded SHA-256 values exactly match the manifest.
- `npm --prefix packages/omo-codex/plugin install --package-lock-only` is stable; the root Bun lock has no CodeGraph entry.
- Utils CodeGraph tests: 100 passed; utils typecheck passed.
- Component: build passed, `bun test ./test` passed 67/67, and `tsc --noEmit` passed.
- OpenCode CodeGraph tests passed 12/12; shipped notice/license validation passed.
- Real darwin-arm64 provisioning launched CodeGraph 1.5.0. A real store created by 1.0.1 was reported initialized by 1.5.0 with zero pending changes.

## Why this is enough

The checks cover pin consistency, artifact availability and integrity, stale-marker replacement, caller-level re-provision routing, generated bundles, package metadata, and real store compatibility.

## Omitted

- Native execution on Linux and Windows; their published artifacts were availability- and checksum-verified.
- Full monorepo build/test; validation stayed focused on the changed CodeGraph surfaces.
