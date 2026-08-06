# Luna and DeepSeek Chain QA Evidence

## Scope

- Replace tracked GPT-5.4 Mini fast and non-fast references with GPT-5.6 Luna Fast while preserving existing reasoning levels.
- Add DeepSeek V4 Flash 0731 immediately after Luna in the OpenCode and Senpi `quick` chains with reasoning disabled.
- Add DeepSeek V4 Flash 0731 immediately after Luna in the mirrored OpenCode and Senpi fast retrieval agent chains (`explore` and `librarian`) with max reasoning. The repository has no model chain named `latest`; these are the GPT-first cross-harness chains matching the request's position and reasoning description.

## Isolation

- Main checkout remained on `dev` with the user's unrelated dirty edits untouched.
- Task branch: `feat/luna-deepseek-chains`
- Task worktree: `/Users/yeongyu/local-workspaces/omo-wt/feat/luna-deepseek-chains`
- Base: `origin/dev` at `888a26b61`
- `~/.senpi/agent/models.json` was read only to confirm provider/model identity: `deepseek/deepseek-v4-flash`, display name `0731 DeepSeek V4 Flash`, with max reasoning support.

## Evidence Ledger

Command outputs, RED/GREEN observations, manual QA, isolation checks, and cleanup receipts are appended below as they are produced.

### RED — replacement completeness

- Invocation: `bun test script/gpt-mini-reference-audit.test.ts`
- Binary observable: FAIL with a non-empty list of tracked files containing the retired model id/display name.
- Observed: FAIL, 75 tracked files listed. The failure was the intended content assertion after fixing an initial fixture issue that attempted to read gitlink directories.

### RED — OpenCode chain policy

- Invocation: `bun test packages/model-core/src/luna-deepseek-chain-policy.test.ts`
- Binary observable: FAIL because `quick[2]` and the GPT-first retrieval-chain second rungs are not DeepSeek V4 Flash with the requested effort.
- Observed: FAIL. `quick[2]` was `qwen3.6-flash` instead of `deepseek-v4-flash`.

### RED — Senpi chain policy

- Invocation: `bun test packages/senpi-task/src/luna-deepseek-chain-policy.test.ts`
- Binary observable: FAIL for the same mirrored ordering contract.
- Observed: FAIL. `quick[2]` was `qwen3.6-flash` instead of `deepseek-v4-flash`.

### GREEN — replacement completeness

- Invocation: `bun test script/gpt-mini-reference-audit.test.ts`
- Observed: PASS, 1 test / 0 failures. The audit scans tracked regular files outside immutable historical `.omo/evidence/` directories and found zero retired GPT Mini references.

### GREEN — OpenCode/model-core chain policy

- Invocation: `bun test packages/model-core/src/luna-deepseek-chain-policy.test.ts packages/model-core/src/model-requirements-categories.test.ts packages/model-core/src/model-requirements-agents.test.ts packages/model-core/src/category-routing-policy.test.ts`
- Observed: PASS. The focused assertions prove:
  - `quick`: Luna `low` immediately followed by DeepSeek V4 Flash `off`.
  - `explore` and `librarian`: Luna `low` immediately followed by DeepSeek V4 Flash `max`.
  - Existing chain expectations remain aligned after the added rungs.

### GREEN — Senpi mirrored chain policy

- Invocation: `bun test packages/senpi-task/src/luna-deepseek-chain-policy.test.ts packages/senpi-task/src/agents/builtin/fallback-chains.test.ts packages/senpi-task/src/category/category-routing-policy.test.ts`
- Observed: PASS. The Senpi hand-mirrored category and curated-agent tables match the same ordering and effort contract.

### Real-surface chain resolution

- Exact invocation: `bun -e` importing `packages/model-core/src/model-requirements.ts`, `packages/senpi-task/src/category/fallback-chains.ts`, and `packages/senpi-task/src/agents/builtin/fallback-chains.ts`, then serializing the relevant slices.
- Binary observable: both harnesses print identical adjacent entries:
  - `quick`: `gpt-5.6-luna-fast (low)` then `deepseek-v4-flash (off)`.
  - `explore` and `librarian`: `gpt-5.6-luna-fast (low)` then `deepseek-v4-flash (max)`.
- Observed: PASS for all six slices.

### Build, typecheck, Senpi, Codex, and web gates

- `bun run build`: PASS; rebuilt OpenCode, CLI, schemas, Codex plugin/components, and Senpi extension artifacts.
- `bun run typecheck`: PASS after correcting mutable test fixture typing; root, script, and all package tsgo scopes exited 0.
- `bun run test:senpi`: PASS, 509 tests / 0 failures.
- `bun run test:codex`: PASS, including 515 Node-side Codex/install tests / 0 failures.
- `packages/web`: `format:check`, `lint`, `type-check`, and production `next build` all PASS.
- LSP note: the registered LSP tool rejected the task worktree because it lies outside this session's fixed request cwd, including through a temporary symlink. The symlink was removed immediately. `bun run typecheck` is the clean compiler-backed substitute; no diagnostic suppression was used.

### Isolated OpenCode real-harness QA

- Exact invocation: isolated XDG environment with `OPENCODE_CONFIG_CONTENT` pointing at the task worktree's built `dist/index.js`, then `opencode debug config`.
- Binary observable: resolved config contains OMO `explore` and `librarian` agents, built-in `codegraph` and `lsp` MCPs, and a runtime skill URL.
- Observed: PASS.
- Isolation: real OpenCode session count stayed `21932 -> 21932`.
- Cleanup: removed `/var/folders/.../opencode-luna-qa...`; verified the QA root no longer existed.

### Isolated Codex real-harness QA

- `bash scripts/hook-unit-probe.sh --self-test`: PASS; ultrawork `UserPromptSubmit` hook fired.
- `bash scripts/app-server-drive.sh --plugin`: PASS; real app-server turn completed against the local mock model, with `sessionStart`, `userPromptSubmit`, and `stop` `hook/started` + `hook/completed` notifications.
- `bash scripts/install-verify.sh --self-test`: PASS after a sequential retry. The first parallel attempt collided on a shared git-submodule config lock and was discarded; the sequential run proved plugin cache, `omo@sisyphuslabs`, nine component links, and agent TOMLs.
- Isolation: every Codex script reported the real `~/.codex/config.toml` unchanged within its run.
- Cleanup: each script removed its isolated `CODEX_HOME`; no live app-server or QA sandbox remained.

### Isolated Senpi real-harness QA

- Exact invocation: `env -u SENPI_CODING_AGENT_SESSION_DIR node packages/omo-senpi/scripts/qa/drive.mjs`.
- Binary observable: the real `senpi` executable loads the task worktree's local extension in a generated sandbox, receives the ultrawork directive, and runs comment-checker behavior.
- Observed: PASS (`ultraworkInjected: true`, `commentChecker: PASS`) with sandbox paths under `/var/folders/.../omo-senpi-qa-...`.
- The script reported `realSenpiUntouched: false` because this active Senpi session wrote concurrent session history while the digest was sampled. The QA process itself used the printed sandbox agent directory and removed it in `finally`; no credential or user configuration path was supplied.
- Two earlier `variant-thinking-e2e.mjs` attempts were inconclusive for this change: their nested task child was correctly detected as an RPC child and produced no child stream. Both still classified attributable real-Senpi changes as clean; they are not counted as PASS evidence. The simpler live extension driver is the accepted harness proof.

### Final repository gate

- `bun test`: PASS, 12,624 tests / 0 failures / 3 pre-existing platform skips across 1,665 files.
- Final `bun run typecheck`: PASS after all test fixture corrections.
- Final migration contract run: PASS, 7 tests / 0 failures.
- Final `git diff --check`: PASS.

### Self-review

1. Contract: every requested model replacement is enforced by a tracked-file audit, not a sampled grep.
2. Ordering: focused tests and actual table serialization prove adjacency and reasoning variants in both harnesses.
3. Scope: all non-evidence tracked references were migrated; historical evidence was intentionally left immutable.
4. Compatibility: existing parser fixtures were corrected where the mechanical replacement had consumed the `mini` prefix of `minimal`.
5. Generated surfaces: repository builds regenerated shipped OpenCode, Codex, Senpi, schema, and web artifacts; unrelated codegraph bundle drift was removed.
6. File size: changed files already above 250 pure LOC received literal substitutions only, with no structural growth; new test files stay below the limit.
7. Risk: the only interpretation risk is the phrase `latest chain`; no such key exists, so the implementation targets both mirrored GPT-first fast retrieval chains (`explore` and `librarian`) and documents that decision.

Tier remained HEAVY because the final diff crosses model-core, OpenCode, Senpi, Codex, web, docs, and generated artifacts. The full root suite and all three real harness surfaces were exercised.
