# Canonical model-chain runtime fallback

Issue: #6644

## Behavioral proof

- Negative control (legacy-only implementation): 5 new tests failed, 9 passed.
- Exact-head focused suite: 280 passed, 0 failed.
- Isolated `doctor --verbose`: 5 passed, 0 failed, 1 warning, 2 skipped.
- Typecheck and build: passed.
- Full suite: 13,490 passed, 5 skipped, 1 unrelated failure.

The provisioned ast-grep 0.43.0 pin is absent. Its test file is unchanged from
`origin/dev`, and the same single assertion fails when run in isolation.

## Isolated OpenCode QA

- OpenCode: 1.18.15.
- Self-check: isolated HOME/XDG paths and database guard passed.
- SSE probe: the real server emitted the runtime fallback trigger
  `session.status`; see `real-sse-final.txt`.
- Isolation guard: the post-fix session `ses_019ad016bffe25lwiU1fliBNDg`
  exists in `qa-home/.local/share/opencode/opencode.db` and has zero matches in
  the live database. The live count changed from 7,138 to 7,139 during QA due
  to unrelated activity under the SaiensCreditSystemRails worktree.
- `doctor --verbose` scanned the isolated `qa-home/.omo/omo.jsonc`, reported
  the config as valid, and exited successfully with no unknown-key or
  deprecated-key warning for `models`, `reasoning`, or rung `max_tokens`.
- `runtime-fallback-model-chain-probe.ts` exercised the production hook. It
  aborted the failed primary session once and dispatched one continuation to
  `openai/canonical-fallback`; the legacy fallback did not win precedence, and
  canonical reasoning, temperature, and token-limit settings reached the
  production `chat.params` state.
- A real OpenCode 1.18.15 server loaded the local plugin and a recording plugin,
  received a real 429 from the isolated fake provider, emitted `session.status`,
  and completed on `openai/gpt-5.6-sol` with `REAL_OPENCODE_FALLBACK_OK`.
  The recorded `chat.params` output and provider request preserve `high`
  reasoning, `max_tokens: 2048`, `serviceTier: priority`, and
  `textVerbosity: low`; see `real-chat-params-final.jsonl`,
  `real-provider-requests-final.jsonl`, and `real-session-messages-final.json`.
- The final post-fix restart accepted canonical rung `max_tokens` without a
  configuration diagnostic, then repeated the same 429 fallback successfully
  in session `ses_019ad016bffe25lwiU1fliBNDg`. See
  `real-sse-postfix.txt`, `real-chat-params-postfix-summary.jsonl`,
  `real-provider-requests-postfix-summary.jsonl`, and
  `real-session-messages-postfix.json`.
- Exact-head review-fix QA configured category-level `max_tokens: 2048` and
  `provider_options` with a setting-free fallback rung. Real OpenCode preserved
  those category defaults in `chat.params` and the provider request, completed
  the fallback, then emitted `session.deleted` when the session was deleted.
  The live database stayed at 7,141 sessions. See
  `real-review-fix-summary.txt`, `real-review-fix-chat-params.json`,
  `real-review-fix-provider-request.json`, and
  `real-review-fix-session-messages.json`.
- Variant-identity QA used an object fallback rung with legacy
  `variant: high`. After the primary 429, OpenCode sent two consecutive turns
  through the base model identity `openai/gpt-5.6-sol`; both retained the
  variant and category prompt settings, proving the second turn did not reset
  fallback state. See `real-variant-identity-summary.txt`,
  `real-variant-identity-provider-requests.json`, and
  `real-variant-identity-session-messages.json`.
- Repeated-rung QA configured the same base model twice with `high` then `low`
  reasoning. After the `high` rung returned 429, real OpenCode advanced to the
  `low` rung, retained category `max_tokens` and provider options, and completed
  successfully. See `real-repeated-rung-summary.jsonl`.
- Primary-rung delegation QA used a one-entry category model chain. The real
  `task` tool launched Sisyphus-Junior with that primary rung and preserved its
  `max_tokens: 1536`, `serviceTier: priority`, and `textVerbosity: low` in both
  `chat.params` and the provider request. All QA sessions were isolated from the
  live database and deleted afterward. See `real-primary-rung-summary.jsonl`.
- Agent-primary QA configured canonical `max_tokens` and `provider_options` on
  the first `agents.explore.models` rung. Real OpenCode preserved all three
  request settings (`1024`, `priority`, and `low`) in `chat.params` and the
  provider request, then deleted the isolated session. See
  `real-agent-primary-summary.jsonl`.
- Agent-scope QA configured `1024/priority` only on an agent primary rung. The
  primary request retained both values; its plain fallback retained neither and
  completed successfully. See `real-agent-scope-summary.jsonl`.
- Provider-options merge QA configured `serviceTier` at category level and
  `textVerbosity` only on the fallback rung. Real `chat.params` and the provider
  request contained both values. See `real-provider-options-merge-summary.jsonl`.
- Exact-head staff QA removed a disabled canonical primary, resolved the
  `Sisyphus - ultraworker` display name, sent distinct `1024/priority/high/max`
  settings on the allowed primary, then completed on the plain fallback without
  those primary-only settings. The isolated session was deleted and had zero
  matches in the live database. See `real-staff-final-summary.jsonl`.
- Final compatibility QA drove the exact local source through an isolated real
  OpenCode 1.18.15 server and SSE stream. The primary returned 429, the plain
  fallback completed without primary-only token or provider settings, both QA
  sessions were deleted, and the live database remained unchanged. The focused
  regression also proves the unconfigured dispatcher branch preserves reasoning
  without leaking temperature, max tokens, or provider options. See
  `real-exact-head-compat-summary.jsonl`.

Run the focused proof:

```sh
bun test packages/omo-opencode/src/hooks/runtime-fallback
bun .omo/evidence/20260809-model-chain-consistency/runtime-fallback-model-chain-probe.ts
```
