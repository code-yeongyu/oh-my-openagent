# Plan: issue #6685 - quick fallback advertises opencode-go/qwen3.6-flash

Worktree: /home/viprix/projects/oom-wt-6685 (branch issue/6685-qwen36-flash-fallback, base dev)

## Root cause (verified)

- Issue filed 2026-08-10: the `quick` category fallback chain paired provider
  `opencode-go` with model `qwen3.6-flash`, but OpenCode Go does not serve that
  model id (live catalog https://opencode.ai/docs/go/, retrieved 2026-08-24:
  qwen3.8-max, qwen3.7-max, qwen3.7-plus, qwen3.6-plus - no flash variant).
- The phantom pairing existed in BOTH the model-core source of truth
  (`packages/model-core/src/category-model-requirements.ts`) and its hand mirror
  (`packages/senpi-task/src/category/fallback-chains.ts`).
- Maintainer already removed it on dev in 75b82be7e (2026-08-16,
  "fix(model-core): correct OpenCode Go quick fallback") using issue option 1:
  drop `opencode-go` from the qwen3.6-flash rung (model stays served by
  qwen-token-plan / alibaba-token-plan / bailian-coding-plan / vercel).
- The issue was never linked/closed, and no structural invariant test guards
  against reintroducing (or newly adding) unserved opencode-go pairings.
- Exhaustive re-scan of HEAD: no remaining chain pairs opencode-go with an
  unserved model. All current Go pairings (kimi-k3, glm-5.2, minimax-m3,
  minimax-m2.7, deepseek-v4-pro, mimo-v2.5-pro, qwen3.7-plus) are in the live
  Go catalog. The stale spot is documentation:
  docs/guide/agent-model-matching.md line ~160 lists `mimo-v2-pro` (not a Go
  model id; live ids are mimo-v2.5 / mimo-v2.5-pro) and omits
  `deepseek-v4-pro`, which OMO routes through opencode-go.

## Changes

1. NEW `packages/model-core/src/opencode-go-provider-invariant.test.ts`
   - Test-local frozen `OPENCODE_GO_PROVIDED_MODELS` set transcribed from the
     official Go endpoints table (URL + retrieval date in comment). No network.
   - Invariant A (issue regression, quick): the qwen3.6-flash rung must not
     list `opencode-go`; every opencode-go rung in `quick` uses a served model.
   - Invariant B (future-proof): EVERY category chain and EVERY agent chain
     rung listing `opencode-go` references a served model id.
   - Verification: RED when run against 75b82be7e^ source (temporary checkout
     of the old category file), GREEN at HEAD.
2. EDIT `docs/guide/agent-model-matching.md` subscription table cell:
   `mimo-v2-pro` -> `mimo-v2.5-pro`, add `deepseek-v4-pro`. Docs-only; aligns
   the guide with the catalog the chains actually route against (issue's
   "policy and documentation disagree" half).

## Verification

- bun test packages/model-core/src/opencode-go-provider-invariant.test.ts (RED before / GREEN after)
- bun test packages/model-core packages/senpi-task (scoped suites green)
- bun run typecheck green
- Evidence under .omo/evidence/20260824-qwen36-flash-fallback/ (force-added; .omo/* is gitignored)

## Out of scope

- No runtime/source behavior change (dev already carries the functional fix).
- No senpi-task source edit (mirror already aligned; cross-package drift tests cover it).
- Submodule/prepare-build environmental failure documented, not worked around.
