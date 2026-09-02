# QA — Codex plugin cache: materialize prompts-core ultrawork directive (beta.33 LazyCodex smoke fix)

Date: 2026-09-02 · base: origin/dev 38a46e6013ecd1b1d68c3c0fde7964f927184732 · compute: bunshin mengmotaMac (darwin-arm64, bun 1.4.0, node 26.7.0) + gorky (linux-x86_64, bun 1.4.0, node 24.4.1). Nothing ran on the session host.

## Defect
publish run 33596952745 (v5.0.0-beta.33) `post-publish-verify / Smoke test published lazycodex-ai` failed: the installer copies only `packages/omo-codex/plugin` into `<CODEX_HOME>/plugins/cache/sisyphuslabs/omo/<version>` and re-runs `npm run sync:skills` there; `sync-skills.mjs` resolved the canonical prompt as `<plugin>/../../../packages/prompts-core/prompts/ultrawork/codex.md` = `plugins/cache/packages/...` -> ENOENT. beta.32's fix (#7630) put the file in the tarball but the flattened cache never sees it.

## Fix
- `src/install/codex-cache-install.ts`: `copyCanonicalPromptSources()` (same pattern as `copyRootRuntimeDists`) materializes `<repoRoot>/packages/prompts-core/prompts/ultrawork/codex.md` at `<pluginRoot>/packages/prompts-core/prompts/ultrawork/codex.md` in the cache.
- `plugin/scripts/canonical-ultrawork-directive.mjs`: `resolveCanonicalUltraworkDirectivePath(pluginRoot, repoRoot)` -> checkout path when present, else plugin-internal copy; `sync-skills.mjs` uses it.
- `scripts/install-dist/install-local.mjs` regenerated (`bun run build:codex-install`); sha256 a3651b8b677d2f064fd825b290b90d8ecad77d72566733ce0f50621441dedcf3, byte-identical on mengmotaMac and gorky; marker `4c2cf806...:774951d3...`.

## C1 installer test (packages/omo-codex/scripts/install-cache-copy.test.mjs)
- RED (tests patch only, committed bundle): `node --test install-cache-copy.test.mjs` -> tests 7 / pass 6 / fail 1 = "#given packaged prompts-core directive ... materialized into the plugin cache" (both machines).
- GREEN (fix + rebuilt bundle): full `node --test packages/omo-codex/scripts/*.test.mjs` after CI-parity prebuilds (build:git-bash-mcp, build:lsp-tools-mcp, build:lsp-daemon): mengmotaMac tests 172 / pass 172 / fail 0. gorky 169/172: the 3 "bun absent everywhere ... omo runtime wrapper" cases fail there before and after the change (host PATH shape), not related.

## C2 resolver test (packages/omo-codex/plugin/test/canonical-ultrawork-directive.test.mjs)
- RED: `ERR_MODULE_NOT_FOUND .../plugin/scripts/canonical-ultrawork-directive.mjs` (module absent on dev).
- GREEN: 2/2 pass (checkout wins; flattened cache falls back to plugin-internal copy).

## C3 real surface — the failing smoke, replayed against the published beta.33 tarball (mengmotaMac, isolated HOME/CODEX_HOME/CODEX_LOCAL_BIN_DIR under /tmp/omo-beta34-c3-mengmotaMac)
- RED (tarball untouched): `node packages/omo-codex/scripts/install-local.mjs install --no-tui --codex-autonomous` -> exit 1
  `Error: ENOENT: no such file or directory, open '.../codex/plugins/cache/packages/prompts-core/prompts/ultrawork/codex.md'` at `sync-skills.mjs:278` (identical to the CI smoke failure).
- GREEN (only install-dist bundle + sync-skills.mjs + canonical-ultrawork-directive.mjs overlaid): exit 0, `Installed 1 plugin(s) from sisyphuslabs.`
  cache 5.0.0-beta.33: `packages/prompts-core/prompts/ultrawork/codex.md` present; `skills/ultrawork/SKILL.md` present and CONTAINS the canonical body byte-for-byte (27374 B inside 27724 B); 26 skills; `omo-agent-toolkit` bin linked.

## C4 adjacent regression (both machines)
- `bun test script/codex-install-bundle-freshness.test.ts script/lazycodex-prompts-core-payload.test.ts`: 3 pass / 0 fail (bundle staged in the index).
- `bun --cwd packages/omo-codex run typecheck`: exit 0.
- `bun test packages/omo-codex/src/install/codex-cache-install.test.ts`: 8 pass / 0 fail.
- plugin `npm ci && bun run build && npm test`: tests 337 / pass 335 / fail 2 — both CodeGraph MCP entry tests (`component-codegraph-mcp-smoke`); reproduced on pristine dev 38a46e6 on gorky (PRISTINE_CG_RC=1), so pre-existing/environmental, not touched by this change.
- publish.yml is unchanged (the earlier CI-side `cp` staging idea was dropped: untestable and duplicated the prompt in the tarball).

## Real ~/.codex untouched
All C3 runs used `CODEX_HOME=/tmp/omo-beta34-c3-mengmotaMac/codex`; no path under the real home was written.
