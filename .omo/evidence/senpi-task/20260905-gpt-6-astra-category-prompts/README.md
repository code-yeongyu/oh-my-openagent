# GPT-6 Astra category prompt appends - verification record (2026-09-05)

Branch `feat/gpt-6-astra-category-prompts` at `cfee1670d` (rebased on dev `0e048206e`), run on mengmotaMac via bunshin in `/tmp/astra-cat-20260905/wt` (shallow clone, `bun install --frozen-lockfile --ignore-scripts`), with an identical dev clone in `/tmp/astra-cat-20260905/base` as the baseline.

| shard | command | branch | dev baseline |
|---|---|---|---|
| senpi-task | `cd packages/senpi-task && bun test --timeout 20000 src/*.test.ts src/**/*.test.ts` | 1313 pass / 0 fail / 1 skip (159 files) | - |
| omo-opencode tools + agents | `bun test --timeout 20000 packages/omo-opencode/src/tools packages/omo-opencode/src/agents` | 1376 pass / 0 fail (149 files) | - |
| omo-opencode cli/config/shared/plugin-handlers/config-migration | `bun test --timeout 20000 ...` | 2178 pass / 1 fail (264 files) | 2178 pass / 1 fail |
| omo-opencode hooks + features | `bun test --timeout 20000 packages/omo-opencode/src/hooks packages/omo-opencode/src/features` | 4246 pass / 47 fail (498 files) | 4246 pass / 47 fail |
| omo-senpi | `bun test --timeout 20000 packages/omo-senpi` | 2673 pass / 13 fail / 32 skip (354 files) | 2673 pass / 13 fail / 32 skip |
| typecheck | `tsgo --noEmit` (root); `bun run typecheck` in packages/senpi-task and packages/omo-senpi | exit 0 | - |

Failing-test name sets were diffed (`comm`) between branch and baseline for the three shards with failures: zero branch-only failures, zero baseline-only failures. Every failure needs a built artifact the `--ignore-scripts` install does not produce (`dist` plugin bundle, synced skills from `build:senpi-plugin`, installer generated artifacts, the ulw-loop child-process probe).

Token counts (o200k, `gpt-tokenizer`): ultrabrain generic 198 -> Astra 228; deep generic 236 / GPT-5.5 variant 588 -> Astra 300; unspecified-high generic 22 -> Astra 224. The three Astra appends are byte-identical across `packages/senpi-task` and `packages/omo-opencode`.

Docs schema block regenerated with `bun script/telemetry-schema-block.mjs` on the same tree.
