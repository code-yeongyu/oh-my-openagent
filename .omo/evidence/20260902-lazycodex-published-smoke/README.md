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
- `codex-qa-app-server-plugin.json`: the real `codex app-server` completed a
  local-mock turn and emitted `hook/completed` for `sessionStart` and
  `userPromptSubmit`; the helper also proved the real Codex config was unchanged.

## Full Codex gate

`bun run test:codex` was executed with Bun 1.4.0. It is red only in the
unrelated CodeGraph sweep CLI case (`candidates` expected PID 601 but received
