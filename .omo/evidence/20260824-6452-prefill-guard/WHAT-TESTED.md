WHAT WAS TESTED
- Failing-first regression: `bun test packages/omo-opencode/src/plugin/messages-transform.test.ts` after adding the parameterized test "#given every Anthropic Claude release at or after its prefill-disabled family floor ..." (scenarios: opus-4-6/4-7/4-8, opus-5, opus-5-fast, sonnet-4-6/4-7, sonnet-5, mythos). RED observed on "opus 5" before the fix (red-failing-first.log), proving the guard silently skipped claude-opus-5.
- Negative path strengthened: existing "models that still allow assistant prefill" scenario list extended with anthropic/claude-haiku-4-5 (prefill-capable, must stay silent) alongside claude-sonnet-4-5.
- Alias-provider matrix unchanged: messages-transform-prefill-alias.test.ts (opencode/opencode-go/copilot/vercel/openrouter namespaces, bedrock dotted ids) still passes untouched.
- Type gate: `bun run typecheck` (tsgo --noEmit root + script + all 30 workspace packages) exit 0 (typecheck.log).

WHAT WAS OBSERVED
- Before fix: 22 pass / 1 fail; failure message `error: opus 5` — claude-opus-5 assistant tail kept unchanged (no synthetic user turn).
- After fix: scoped suites green — 25 pass / 0 fail across messages-transform.test.ts + messages-transform-prefill-alias.test.ts (green-scoped.log).
- Behavior parity preserved for every id in src/generated/model-capabilities.generated.json: sonnet-4, sonnet-4-20250514, sonnet-4-5(+date), sonnet-4-thinking, haiku-4-5 remain SILENT; opus-4.x and sonnet-4-6+ still FIRE. Newly FIRE: claude-opus-5, claude-opus-5-fast, claude-sonnet-5(-free), plus any future claude-(opus|sonnet)-<major> at/above the floors.

WHY IT IS ENOUGH
- The regression test drives the real exported handler (createMessagesTransformHandler) end-to-end through ensureUserTurnAfterAssistantTail, asserting the exact synthetic recovery payload for each floor-covered model, so the Anthropic 400 precondition (history ending on an assistant turn for a prefill-disabled model) is covered at the unit seam where it is deterministic.
- Version parsing stops at word suffixes (-fast, -thinking) and dated snapshot tokens (-20250514), verified against the tracked model-capabilities registry ids, so no prefill-capable registry model flips to firing.
- Remaining risk: a future Anthropic family (not opus/sonnet/mythos) disabling prefill would need its row added to ASSISTANT_PREFILL_UNSUPPORTED_MODEL_FAMILIES; that is a one-line data change by design.

WHAT WAS OMITTED
- Issue suggestion #3 (log when the guard fires/declines): omitted to keep the diff minimal; noted as follow-up in the PR body.
- No live opencode session QA: the change is confined to a pure transform function with no new hook wiring; the deterministic unit surface above covers the changed predicate. No secrets, tokens, or env dumps are present in captured logs.
