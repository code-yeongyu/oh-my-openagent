# LazyCodex published smoke repair evidence

## Root cause

`lazycodex-ai@5.0.0-beta.33` ships the canonical Codex ultrawork prompt after
PR #7630, but its installer copies only `packages/omo-codex/plugin` into the
flattened Codex cache. `installCachedPlugin()` then ran `npm run sync:skills`
only for packaged installs. That generator resolves the prompt as a sibling of
the repository `packages` directory, which becomes
`$CODEX_HOME/plugins/cache/packages/prompts-core/...` after flattening and does
not exist. The install therefore failed before wrapper links were created.

The repair leaves aggregate skills generated during the source plugin build and
does not rerun their source-only generator after a packaged plugin is copied to
the cache.

## Failing-first regression

- RED: `focused-regression.red.txt` shows the new packaged-cache case invoking
  `npm run sync:skills` and failing at the cache path.
- GREEN: `focused-regression.final-green.txt` shows all eight cache-install
  tests passing, including the new assertion that only `npm ci --omit=dev` is
  invoked and the prebuilt ultrawork skill survives unchanged.
- Generated installer: `generated-installer-tests.final.txt` passes 13 Node
  installer-bundle tests after `build-codex-install-bun-1.4.0.txt`.

## Package and harness validation

- `build-root-bun-1.4.0-restored.txt`: pinned Bun 1.4.0 root build passed.
- `omo-codex-typecheck-bun-1.4.0-final.txt`: `tsgo --noEmit -p tsconfig.json`
  passed in `packages/omo-codex`.
- `publish-shaped-fixed-assertion-status.txt`: a disposable publish-shaped
  local tarball, deliberately omitting `prompts-core`, passed separate dry-run,
  install, cache/config, wrapper, help, and marked/unmarked legacy-wrapper
  assertions. `publish-shaped-fixed-isolation.txt` records isolated HOME,
  CODEX_HOME, bin directory, real-config hash equality, and cleanup.
- `codex-qa-install-verify.txt`: local installer landed the cache, enabled
  `omo@sisyphuslabs`, and linked bins plus agent TOMLs in an isolated home.
- `codex-qa-app-server-plugin.txt`: the real `codex app-server` completed a
  local-mock turn and emitted `hook/completed` for `sessionStart` and
  `userPromptSubmit`; the helper also proved the real Codex config was unchanged.

## Full Codex gate

`bun run test:codex` was executed with Bun 1.4.0. It is red only in the
unrelated CodeGraph sweep CLI case (`candidates` expected PID 601 but received
`[]`); the complete local output is `test-codex-bun-1.4.0.txt`. The unchanged
`a0dd6cc91` control worktree produces the same empty candidate set in
`test-codex-codegraph-baseline.txt`, so this is unrelated to the installer
change.

PR CI is the authoritative clean Codex gate for this commit: CI run
`33600631170` passed `codex-compatibility (ubuntu-latest, full)` and the macOS
and Windows platform lanes, as well as `lazycodex-published-smoke`, at
`901d1c3c9`. Those standardized runner lanes exercise the submitted commit
rather than this workstation's pre-existing CodeGraph test condition.

## Why this is enough

The red-to-green installer seam pins the removed invalid subprocess, the
publish-shaped tarball proves the generated packaged installer succeeds without
the unavailable prompt sibling, and real Codex app-server notifications prove
the installed plugin hooks run. Green PR CI then validates the submitted commit
on the repository's required platforms and Codex lanes.

## What was omitted

Raw environment dumps, npm caches, temporary package tarballs, temporary
Codex homes, and mock-server logs are omitted because they are transient or may
contain machine-specific paths. The committed summary and named sanitized logs
retain each command result, isolation proof, and cleanup outcome.
