# Published LazyCodex beta.33 smoke repair

## Goal

Repair the first product defect exposed by published `lazycodex-ai@5.0.0-beta.33` without changing release versions or using the real Codex home. Deliver one unmerged PR to `dev` after required CI and Cubic pass, or record a Cubic quota skip.

## Execution checklist

- [done] Reproduce the published package in disposable `HOME`, `CODEX_HOME`, and `CODEX_LOCAL_BIN_DIR`; record dry-run, install, config, cache, agent, and wrapper checks independently.
- [done] Trace the first failing assertion through the published artifact and installer source; identify the minimal machine-consumed installer/publish-smoke seam.
- [done] Add a focused failing regression proving a published cache does not execute source-only skill regeneration; capture its red result.
- [done] Implement the smallest source fix; regenerate the published installer bundle; run the focused regression green and diagnostics.
- [done] Run `bun run test:codex`, relevant build, and isolated local Codex install plus app-server plugin proof; preserve sanitized artifacts under `.omo/evidence/20260902-lazycodex-published-smoke/`. The Codex gate reaches an unrelated pre-existing macOS CodeGraph assertion failure, reproduced on an untouched identical-base worktree.
- [in progress] Review the focused diff and validation evidence; commit the atomic repair, push, and open an English PR targeting `dev`.
- [pending] Wait for every required PR check and Cubic; fix only reported defects, then leave the green PR unmerged.

## Findings

- `lazycodex-ai@5.0.0-beta.33` contains `packages/prompts-core/prompts/ultrawork/codex.md` after PR #7630, but `installCachedPlugin()` copies only `packages/omo-codex/plugin` into the flattened `CODEX_HOME/plugins/cache/.../.tmp-<version>` tree.
- `installCachedPlugin()` then invokes `npm run sync:skills` only for `buildSource === false`; `sync-skills.mjs` resolves its canonical prompt by walking from plugin root to a repository `packages/prompts-core` sibling. In the flattened cache that resolves to `CODEX_HOME/plugins/cache/packages/prompts-core/...`, which does not exist.
- The release job's compound condition hid this first product failure; isolated execution recorded the exact ENOENT in `published-install.txt` before wrappers were linked.

## Validation contract

1. The published beta package's dry-run install and doctor routing pass independently; its actual beta.33 install fails only at the recorded pre-fix source-only skill regeneration seam, without reading or writing the real `~/.codex`.
2. A focused installer regression fails before the correction and passes afterward, proving a prebuilt published plugin cache never invokes `sync:skills` after flattening.
3. Focused tests, `bun run test:codex`, the relevant build, isolated installer verification, and `codex app-server` plugin hook proof are green and evidenced.

## Stop condition

Stop when the PR is open and unmerged, all required CI checks are green, Cubic is green or its quota skip is documented, and the root cause, exact validation, and evidence paths are recorded.

## Evidence

- Published beta.33 red: `.omo/evidence/20260902-lazycodex-published-smoke/published-install.txt`
- Focused red then green: `focused-regression.red.txt`, `focused-regression.final-green.txt`
- Publish-shaped local tarball pass: `publish-shaped-fixed-assertion-status.txt`
- Isolated real-Codex proofs: `codex-qa-install-verify.txt`, `codex-qa-app-server-plugin.txt`
- Full gate result and independent control: `test-codex-bun-1.4.0.txt`, `test-codex-codegraph-baseline.txt`
