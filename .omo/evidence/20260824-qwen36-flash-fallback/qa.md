QA Evidence - 20260824 - issue #6685 qwen3.6-flash opencode-go fallback

## WHAT WAS TESTED

- Surface: hardcoded model fallback chains (packages/model-core/src/category-model-requirements.ts,
  packages/model-core/src/agent-model-requirements.ts) against the OpenCode Go
  served-model catalog, plus the user-facing docs table in
  docs/guide/agent-model-matching.md.
- Command: new structural invariant test
  `bun test packages/model-core/src/opencode-go-provider-invariant.test.ts`
  (offline fixture transcribed from https://opencode.ai/docs/go/ endpoints
  table, retrieved 2026-08-24; no network in tests).
- Fails-before proof: temporarily checked out the pre-fix chain source
  (`git checkout 75b82be7e^ -- packages/model-core/src/category-model-requirements.ts`,
  the revision where `quick` still paired `opencode-go` with `qwen3.6-flash`),
  ran the new test, restored HEAD source, re-ran.

## WHAT WAS OBSERVED

- before-fix-red.txt: 0 pass / 3 fail at 75b82be7e^ - quick-chain invariant,
  qwen3.6-flash-rung assertion, and all-chains invariant all detect the
  phantom `opencode-go` + `qwen3.6-flash` pairing.
- after-fix-green.txt: 3 pass / 0 fail at HEAD.
- scoped-tests.txt: `bun test packages/model-core packages/senpi-task` -
  2101 pass / 1 skip / 0 fail (280 files).
- typecheck.txt: `bun run typecheck` (tsgo --noEmit + script + all workspace
  packages incl. model-core, senpi-task, omo-opencode) - exit 0.
- Exhaustive scan of HEAD found NO remaining chain rung pairing opencode-go
  with an unserved model id; every current Go pairing (kimi-k3, glm-5.2,
  minimax-m3, minimax-m2.7, deepseek-v4-pro, mimo-v2.5-pro, qwen3.7-plus) is
  in the live catalog.

## WHY IT IS ENOUGH

- The functional fix for #6685 already landed on dev (75b82be7e, 2026-08-16);
  this change adds the missing structural regression lock (fails on any future
  chain edit that pairs opencode-go with a model outside the served catalog,
  across ALL categories and agents) and aligns the one stale docs cell
  (`mimo-v2-pro` -> `mimo-v2.5-pro`, adds `deepseek-v4-pro`) so guide and
  routing policy agree, which is part of the issue's expected behavior.
- No runtime/source behavior changed, so harness-driving QA (opencode-qa /
  codex-qa / senpi-qa live skills) has no behavioral surface to exercise; the
  unit gates above are the full verification scope for a test+docs change.

## WHAT WAS OMITTED

- Environment limitation (pre-existing, unrelated to this change):
  `bun install`'s prepare hook fails because git submodules under
  packages/shared-skills/upstreams/ cannot resolve their pinned revisions in
  this worktree ("Unable to find current revision ... open-design"); their
  object store lives under the main checkout's .git, which task constraints
  forbid touching. Dependency installation itself succeeded; only the bundled
  dist build is blocked, which source tests and tsgo typecheck do not need.
- Raw bun/test output truncated to tails in artifacts; no secrets, tokens, or
  env dumps were produced or recorded.
