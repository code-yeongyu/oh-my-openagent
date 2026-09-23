# fix: current model versions in the shipped requirement chains

Date: 2026-09-23 · Branch: `fix/latest-model-versions` · Worktree: `/Users/cminseo/Developer/omo-model-latest` (base `origin/dev` @ `33d9e8a4`)

## Merge update plan (2026-09-23)

The current user request supersedes the original implementation plan below.
Merge fetched `origin/dev` (`9d5e485fbc310f10afe1fc56d0f2ce4b6ddb23be`)
into the existing task branch without rebasing or force-pushing.

- Resolve `packages/model-core/src/category-model-requirements.ts` and
  `packages/senpi-task/src/category/fallback-chains.ts` with upstream's
  artistry order: Fable, narrowed Opus 5.5, retained Opus 5, Kimi.
  Preserve every upstream GPT-6 rung and the PR's GLM 5.3 bumps.
- Resolve `category-routing-policy.test.ts`,
  `model-requirements-categories.test.ts`, and Senpi's
  `category/fallback-chains.test.ts` by pinning the complete merged chains.
- Rebuild the conflicting `plugin/extensions/omo.js` and `omo-task.js`
  through `bun run build:senpi-plugin`; retain generated companion changes
  produced by that same build, never hand-edit bundles.
- Verify automatic merges, run all three user-named gates, and run isolated
  real Senpi smoke QA. Record results and semantic decisions in `report.md`.
- Commit the verified merge, push `submission fix/latest-model-versions`
  normally, and report PR #8699 state. Do not merge the PR upstream.

The first merged package gate exposed an additional upstream assertion:
`gpt-6-family-routing.test.ts` equated Opus 5.5 providers with Fable's.
Update that pinned expectation to Anthropic-only plus exact Opus 5 fallback
coverage. Apply this same policy to the newly added Prometheus rung in
`agent-model-requirements.ts` and its `model-requirements-agents.test.ts`
expectations. Prove the change first with the focused red test run, then
rerun all required gates. Record all decisions in the merge report.

## Original implementation rationale (historical)

OmO's shipped agent/category fallback chains lag the current catalogs and still name the pre-rename provider id `openai-codex`. A rung that names a retired model id, or a provider the runtime no longer exposes, silently stops matching — the chain degrades without any error.

## Verified availability (installed catalog refreshed 2026-09-23; provider rows via `omo --offline --list-models <id>`)

| chain currently uses | newest in family | providers serving the newest | action |
|---|---|---|---|
| `claude-opus-5` (providers: anthropic, github-copilot, opencode) | `claude-opus-5-5` | anthropic, anthropic-subscription, amazon-bedrock, venice — **not** github-copilot/opencode | ADD a `claude-opus-5-5` rung above; keep the `claude-opus-5` rung (coverage would narrow) |
| `glm-5.2` (zai-coding-plan, opencode, bailian-coding-plan) | `glm-5.3` | opencode, opencode-go, alibaba-token-plan, cloudflare-*, nvidia, opengateway, openrouter | replace |
| `qwen3.7-plus` (opencode-go, bailian-coding-plan) | `qwen3.8-max` or `qwen3.8-flash` (no `3.8-plus` exists) | opencode-go serves both; also openrouter/alibaba | replace with `qwen3.8-max` (same non-flash tier); state the tier choice |
| `deepseek-v4-flash` (provider: deepseek) | `deepseek-v4.1-flash` | opencode-go, openrouter, alibaba-token-plan, vercel — check whether the `deepseek` provider serves it | replace only if the `deepseek` provider serves `deepseek-v4.1-flash`; otherwise keep and document |
| `gemini-3.1-pro` (google, github-copilot, opencode) | no `3.5/3.6/3.7/3.8-pro` exists (only `-flash` variants) | — | KEEP `gemini-3.1-pro`; document that no pro successor exists |
| `claude-fable-5-1`, `kimi-k3`, `gpt-6-astra`, `gpt-5.6-sol/terra/luna-fast`, `claude-haiku-4-5`, `minimax-m3` | already latest | — | no change |

## Provider rename follow-up (correctness, same PR)

`openai-codex` → `chatgpt-subscription` wherever it is a **provider id**. Never touch the wire api id `openai-codex-responses`.

Known carriers (re-grep before editing; counts drift):
- `packages/model-core/src/agent-model-requirements.ts` (~14)
- `packages/model-core/src/category-model-requirements.ts` (~9)
- `packages/model-core/src/model-requirements-agents.test.ts` (~14), `model-requirements-categories.test.ts` (~11), `category-routing-policy.test.ts` (~5)
- `packages/senpi-task/src/category/openai-categories.ts` (~4) and its co-located tests (`openai-lane.test.ts`, `openai-categories.test.ts`, `gating.test.ts`, `resolve-category.test.ts`, `runtime-fallback-record.test.ts`, `progress.test.ts`)
- docs / READMEs / web messages: update only where the id is a live routing/provider reference, not historical prose or changelog entries.

## Rules

- Same family + newest + same providers → replace. Coverage would narrow → ADD a rung above instead of dropping the old one.
- No tier invention without documenting it in the PR body and the evidence file.
- Minimal diff: no unrelated formatting, no regenerated artifacts (do not run `build-model-capabilities`).
- Biome clean on every changed file; every pinned expectations test updated in the same change (never weakened).

## Verification

- Package tests: `bun test packages/model-core packages/senpi-task` (adjust to the repo's per-package commands if they differ).
- Audit: `bun test script/opus5-model-recommendation-audit.test.ts`
- Senpi gate (senpi-task touched): `bun run test:senpi` and `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
- `bunx biome check` on the changed files.
- Evidence: `.omo/evidence/20260923-latest-model-versions/report.md` with WHAT WAS TESTED / WHAT WAS OBSERVED / WHY IT IS ENOUGH / WHAT WAS OMITTED.

## Deliverable

Commit(s) on `fix/latest-model-versions`, pushed to the `submission` remote (fork `trac3r00/oh-my-openagent`), PR opened against `code-yeongyu/oh-my-openagent:dev` with a reviewer-readable English body (what/why/observed/QA/residual risk). No force-push. No merge attempt (the fork has no write access upstream).
