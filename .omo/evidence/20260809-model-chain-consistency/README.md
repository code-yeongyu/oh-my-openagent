# Canonical model-chain runtime fallback

Issue: #6644

## Behavioral proof

- Negative control (legacy-only implementation): 5 new tests failed, 9 passed.
- Patched focused suite: 288 passed, 0 failed.
- Related config and Doctor suites: 21 passed, 0 failed.
- Typecheck and build: passed.
- Full suite: 13,469 passed, 5 skipped, 2 unrelated failures.

The unrelated failures are outside this PR's diff: the provisioned ast-grep
0.43.0 pin is absent, and `packages/omo-senpi/plugin/skills/ulw-loop/SKILL.md`
does not match its native source (`omo` versus `omo-agent-toolkit`).

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

Run the focused proof:

```sh
bun test packages/omo-opencode/src/hooks/runtime-fallback
bun .omo/evidence/20260809-model-chain-consistency/runtime-fallback-model-chain-probe.ts
```
