# Giant tool results break provider requests and compaction — incident & fix

**Date:** 2026-07-31
**Status:** PR-ready (branch `fix/senpi-cap-giant-tool-results`)
**Target repo:** `code-yeongyu/oh-my-openagent` (omo-senpi adapter)

---

## 1. Incident summary

In 그림수세미 project sessions run with **GPT (gpt-5.6-sol via openai-codex) as the main model**,
work repeatedly stalled: the harness looked like it was "compacting forever" while no progress was
made. The user reported it as "GPT에서 계속 컴팩션하다 작업을 진행 못함". Two sessions show the
full picture.

| Session | Model | Context peak | Compaction events | Empty/failed assistant responses |
|---|---|---|---|---|
| `019faf4f` (576 MB, 23.5 h) | gpt-5.6-sol only | 255 K tokens | 3 | 20 (clustered after giant tool results) |
| `019fb282` (11 MB, 6.5 h) | gpt-5.6-sol → deepseek-v4-pro | **654 K tokens** | 0 | 0 (stalled differently: admission deadlock) |

Both sessions end with the user asking "왜 중지 되었니" / "왜 작업이 안대" / "멈추지 말고 끝까지".

## 2. Root cause chain

1. **`apply_patch` results carry full file contents.** One delete of a `.omo/evidence` file produced a
   **476 MB single tool result** (session line 4069); ~30 more results were 200–740 KB. `read` with an
   image and `eval`/`lsp_symbols` added more 200–450 KB entries.
2. **Live tool results are not size-capped.** The core truncation (`tool-truncation.js`, 4 KB
   threshold) runs only during compaction; results enter the conversation context uncapped. The
   476 MB line has no truncation marker.
3. **The provider request fails.** Serializing the giant context throws a JS **"Invalid string
   length"** error. GPT (Codex) also added `servers overloaded`, 403 usage-limit, WebSocket, and
   stream-timeout errors.
4. **Compaction fails with the same error.** `session.log` shows the loop:
   ```
   09:31:50  provider_error           "Invalid string length"
   09:38:04  compaction_decision      "Compaction failed: Invalid string length"  willRetry:false
   09:38:05  provider_error           "Invalid string length"
   09:38:30  compaction_decision      "Compaction failed: Invalid string length"
   09:44:03  compaction_decision      "Compaction failed: Invalid string length"
   09:44:04  provider_error           "Invalid string length"
   ```
   Provider attempt → compaction attempt → both fail → repeat. The user sees "compacting forever,
   no progress". The goal state records `provider error ended the turn (retries exhausted)`.
5. **Admission gate deadlocks once the threshold is exceeded.** In `019fb282` at 15:32:43 (the
   second the user switched models):
   ```
   compaction_decision  reason:"threshold"  accepted:false  aborted:true
   provider_error       "Context remains above the compaction threshold because compaction did not complete"
   prompt_rejected      stage:"admission"  "RequiredCompactionError"
   ```
   Every request is rejected until compaction completes; compaction cannot complete with a 654 K-token
   context that includes the uncapped results. Work is fully blocked.
6. **Model switch is the escape hatch.** After switching to deepseek-v4-pro at 15:32:43, the same
   context completed the work by 16:45 (server started). The failure is provider-request serialization
   hitting the giant strings — any model with a smaller request path also fails, but the deepseek
   provider accepted the payload.

## 3. This PR (defense layer: cap giant tool results at the source)

Adds a `result-size-cap` component to `packages/omo-senpi` that intercepts Senpi's `tool_result`
hook, immediately before the result is admitted to the transcript/provider context. Using the hook
instead of wrapping `registerTool` is intentional: builtin and later-registered extension tools cannot
bypass the cap through registration order.

- A text block above **1 MB** is reduced to a UTF-8-byte-aware head + marker + tail.
- The total textual payload is also capped at **1 MB**, so many individually small blocks cannot bypass
  the limit; non-text blocks retain their relative order.
- Threshold/head/tail and aggregate threshold are configurable; defaults are 1 MB / 800 / 400 / 1 MB.
- Forged truncation-marker text is treated as ordinary input and cannot bypass the cap.
- Image blocks pass through untouched; unchanged results are returned by identity.
- Logging contains only byte/block counts and tool name, never the discarded payload.
- Disable flag: `--omo-senpi-result-size-cap-disabled` (compose registers it like every component).

**Files**

| File | Purpose |
|---|---|
| `packages/omo-senpi/src/components/result-size-cap/cap.ts` | pure capping functions |
| `packages/omo-senpi/src/components/result-size-cap/component.ts` | pre-admission `tool_result` hook |
| `packages/omo-senpi/src/components/result-size-cap/*.test.ts` | unit and hook integration tests |
| `packages/omo-senpi/src/extension/index.ts` | component registration (2 lines) |
| `docs/reference/senpi-giant-tool-result-compaction-failure.md` | this report |
| `plugin/extensions/omo.js` | **generated bundle — must be regenerated before merge** |

**Verification:** focused unit/hook tests, the full omo-senpi suite, and package typecheck pass. An
isolated live Senpi preflight proves an 8 MB single block and a multi-block aggregate payload are capped,
the secret middle bytes never reach the persisted transcript, exactly one metadata event is emitted per
capped result, the next turn still succeeds, and the real agent directory remains unchanged.

## 4. Recommended senpi-core fixes (separate issues)

The extension cap prevents the trigger for omo-senpi installs. The core (`@code-yeongyu/senpi`)
should additionally:

1. **Make compaction survive oversized single strings.** `Compaction failed: Invalid string length`
   with `willRetry:false` leaves the session in an infinite provider↔compaction retry loop. Truncate
   or stream the payload instead of failing, or surface a clear user-facing error + new-session
   guidance when compaction cannot complete.
2. **Never deadlock behind the admission gate.** `RequiredCompactionError` blocks every request until
   compaction completes, and compaction can be unable to complete. Block with a bounded, visible
   outcome (fail the turn with an actionable error) instead of an unbounded silent block.
3. **Apply result truncation to live tool results**, not only during compaction
   (`tool-truncation.js` currently runs in the reduction path only). This is the root prevention for
   all providers, not just omo-senpi users.

## 5. User guidance (until the core fix lands)

- Do not use GPT as the main model for large autonomous sessions in this project (evidence: the same
  work completed after switching to deepseek).
- Do not run `apply_patch` on huge files (evidence bundles, `package-lock.json`); delete via `rm`/git
  and keep diffs narrow.
- Start a new session once the context approaches ~200 K tokens instead of continuing to grow it.

## 6. Issue / PR handoff summary

- **Issue title:** `[compaction] Giant tool results cause "Invalid string length" provider/compaction failure loop and admission deadlock`
- **Issue body:** sections 1–2 (incident + root cause + session.log evidence) + section 4 (core fixes).
- **PR title:** `fix(senpi): cap giant tool results so oversized strings cannot enter context`
- **PR body:** section 3 (changes + verification) + section 4 (core follow-up). Note the
  `plugin/extensions/omo.js` bundle regeneration requirement.
