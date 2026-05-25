# Runtime Fallback Stale Subagent Investigation Handoff

Date: 2026-05-26
Status: Confirmed root cause; fix prepared and locally validated
Target reader: Claude Opus or another investigator continuing the work

## Scope And Safety Constraint

Investigate delegated OpenCode tasks that appear stale after a primary model
failure. During live inspection, do not stop, signal, attach to, or otherwise
mutate the user's active OpenCode process. Process and log reads are allowed.

The incident is not simply "the user stopped a run." In two observed runs,
subagents had already stopped making progress before the user interrupted the
parent workflow.

## Executive Finding

There are two related runtime-fallback stall defects on the local plugin
stack:

1. An already-patched prompt-gate ownership bug could prevent a replacement
   prompt from dispatching after `session.status` interrupted a synchronous
   delegation. This is covered by open PR
   [#4425](https://github.com/code-yeongyu/oh-my-openagent/pull/4425).
2. A newly confirmed event-boundary type bug stores OpenCode's object-shaped
   model payload in the string-based `FallbackState`. The next fallback
   selection throws `TypeError: current.toLowerCase is not a function`,
   preventing fallback dispatch while the task poller keeps waiting.

The second defect reproduces both when OpenAI returns a provider retry/quota
path and when OpenAI has been removed and the configured model yields
`model_not_found`.

## Live Evidence

All plugin timestamps below are UTC; Berlin local time is UTC+2 on this date.
Log sources were `/tmp/oh-my-opencode.log` and the normal OpenCode log under
`~/.local/share/opencode/log/`.

### Current Run After OpenAI Credentials Were Removed

The normal runtime was started with `opencode --continue` at approximately
`2026-05-25T22:10:44Z` (`2026-05-26 00:10:44 CEST`). Its plugin bundle is the
deployed `oh-my-openagent-runtime/dist/index.js`, not the feature checkout.

At `2026-05-25T22:17:02Z`, an Oracle child was created with:

```json
{"id":"gpt-5.5","providerID":"openai","variant":"high"}
```

The child immediately emitted `model_not_found`; runtime-fallback logged
`session.error received` followed by `hook execution failed`, with no
replacement child dispatch. The task poller then repeatedly reported
`sessionStatus:"not_in_status"`.

At `2026-05-25T22:18:14Z` and `22:18:38Z`, watchdog fallback attempts for
other subagents produced the direct stack:

```text
TypeError: current.toLowerCase is not a function
  at isEquivalentModel (.../oh-my-openagent-runtime/dist/index.js)
  at findNextAvailableFallback (...)
  at prepareFallback (...)
  at dispatchFallbackRetry (...)
```

At the last read-only check, `2026-05-26 00:32 CEST`, the Oracle child was
still being polled at count `910`, with roughly `917s` inactive time. The
running OpenCode process was not stopped or altered during investigation.

### Earlier Quota-Limit Run

In the prior run, OpenAI was available but returned usage-limit failures. For
several Metis and Oracle children, `session.created` stored the same
object-shaped OpenAI model payload. A subsequent provider auto-retry
`session.status` event aborted the initial request and immediately logged
`hook execution failed`; the child then remained in
`sessionStatus:"not_in_status"` polling until the user stopped the parent run.

This establishes that removing credentials did not create the stall. It made
the failure quicker to reproduce through `model_not_found`; the same state
corruption already existed on quota-triggered fallback.

### Log Interpretation Note

The Bun runtime-fallback tests use the same logger path and append synthetic
session ids such as `session-object-model` to `/tmp/oh-my-opencode.log`.
Entries around `2026-05-25T22:30:36Z` with those synthetic ids are test
validation, not recovery activity from the live OpenCode process.

## Root Cause

`session.created` from OpenCode carries `info.model` as an object, but
`src/hooks/runtime-fallback/event-handler.ts` typed and used it as a string:

```typescript
const sessionInfo = props?.info as { id?: string; model?: string } | undefined
sessionStates.set(sessionID, createFallbackState(sessionInfo?.model))
```

`FallbackState.currentModel` is later passed into
`src/hooks/runtime-fallback/fallback-state.ts`, whose equivalence comparison
calls `current.toLowerCase()` on unparseable values. With the runtime object in
state, that call throws before the configured fallback model can be dispatched.

The same unsafe assumption also existed at model bootstrap boundaries in:

- `message-update-handler.ts`
- `session-status-handler.ts`
- `first-prompt-watchdog.ts`

## Prepared Change

Checkout: `oh-my-openagent/`
Branch / upstream PR head: `fix/background-agent-avoid-extra-messages-call`
PR: [code-yeongyu/oh-my-openagent#4425](https://github.com/code-yeongyu/oh-my-openagent/pull/4425)

The working change introduces `src/hooks/runtime-fallback/event-model.ts` to
normalize both accepted payload forms:

```text
"openai/gpt-5.5" -> "openai/gpt-5.5"
{ providerID: "openai", id: "gpt-5.5", variant: "high" }
  -> "openai/gpt-5.5(high)"
{ providerID: "opencode-go", modelID: "glm-5" }
  -> "opencode-go/glm-5"
```

It applies that boundary normalization in `event-handler.ts`,
`message-update-handler.ts`, `session-status-handler.ts`, and
`first-prompt-watchdog.ts`. This keeps the fallback state machine string-based
and prevents a new event path from recreating the same corrupted state.

Regression coverage added:

- `event-handler.test.ts`: an object-shaped created model followed by
  `ProviderModelNotFoundError` dispatches `opencode-go/glm-5`.
- `session-status-handler.test.ts`: an object-shaped status model can
  bootstrap fallback state without a prior created event.
- `first-prompt-watchdog.test.ts`: object-shaped user-message models are
  normalized before watchdog fallback.

Local validation already run:

```bash
bun test src/hooks/runtime-fallback/event-handler.test.ts \
  src/hooks/runtime-fallback/session-status-handler.test.ts \
  src/hooks/runtime-fallback/first-prompt-watchdog.test.ts \
  src/hooks/runtime-fallback/index.test.ts
# 110 pass, 0 fail

bun run typecheck
# passed
```

## Local Runtime Layout

Normal daily runtime and test runtime are deliberately separated. The local
`omoStack/` aggregate directory contains `RUNTIME-SETUP.md` with commands and
promotion steps; that machine-specific record intentionally remains outside
this upstream-facing repository document.

| Purpose | Checkout / branch | State at investigation |
| --- | --- | --- |
| Normal plugin runtime | `oh-my-openagent-runtime/`, `runtime-stable` | Deployed commit `df840c6c`, contains the bug described here |
| Plugin PR development | `oh-my-openagent/`, `fix/background-agent-avoid-extra-messages-call` | Contains the prepared normalization fix |
| Normal OpenCode binary | `opencode-runtime/`, `runtime-stable` | Deployed commit `ed1621e6d` |
| OpenCode development | `opencode/`, `local-stable` | Dirty; do not treat as a clean deploy source |
| Desktop client | `claw-code/`, `fix-alias-resolution` | Separate issue area; no matching stale-agent report found in targeted search |

Do not promote the plugin change into `oh-my-openagent-runtime/` while using
the current live process as evidence. Build and validate through the isolated
test profile first; promotion is a deliberate follow-up.

## Related Repository Work

### oh-my-openagent

- [#4425](https://github.com/code-yeongyu/oh-my-openagent/pull/4425) is open
  and is the correct target for this new fix. It already covers the earlier
  synchronous prompt-reservation stall and consolidates prior fallback fixes.
- [#4426](https://github.com/code-yeongyu/oh-my-openagent/pull/4426) is closed
  in favor of `#4425`; it only accepted extra message-fetch test counts.
- [#4006](https://github.com/code-yeongyu/oh-my-openagent/issues/4006) is a
  completed earlier report for internal aborts resetting retry state. It is
  adjacent but not the object-model crash.
- Historical superseded PRs on the same investigation chain include `#4375`
  through `#4378` and `#4424`.

### opencode

- [anomalyco/opencode#16867](https://github.com/anomalyco/opencode/issues/16867)
  is an open upstream feature request for cooldown-aware runtime failover.
- [anomalyco/opencode#29048](https://github.com/anomalyco/opencode/pull/29048)
  and its issue
  [#29054](https://github.com/anomalyco/opencode/issues/29054) are open and
  address empty task output preventing fallback, not this plugin exception.
- [anomalyco/opencode#29047](https://github.com/anomalyco/opencode/pull/29047)
  and its issue
  [#29143](https://github.com/anomalyco/opencode/issues/29143) are open and
  address infinite native retry loops, also distinct from this exception.

### claw-code

- The local `claw-code/` checkout has the already-merged upstream PR
  [ultraworkers/claw-code#3041](https://github.com/ultraworkers/claw-code/pull/3041)
  concerning model alias syntax, not stale delegated agents.
- Targeted searches for stale subagent, runtime fallback, quota, and stuck task
  reports in `ultraworkers/claw-code` returned no matching item during this
  investigation. This is a bounded search result, not proof of absence.

## Remaining Work And Knowledge Gaps

1. Run the prepared patch through `opencode-test` with a deterministic failing
   primary model and working fallback, covering synchronous and background
   delegation. Do not reuse the current live evidence session.
2. Determine whether completed background sessions being re-armed by
   `first-prompt-watchdog` is an independent lifecycle bug. In the current
   run, completed Librarian/Metis work was later subjected to watchdog fallback
   attempts.
3. Decide whether `#4425` should remain a consolidated PR or split the
   event-model fix into a smaller review unit. The failure is within the same
   runtime-fallback stall surface, so updating `#4425` is presently the most
   coherent choice.
4. After test-profile verification, cherry-pick the verified plugin commit to
   `oh-my-openagent-runtime/runtime-stable`, build it, and update the local
   runtime setup record and checksum.
5. Consider filing a narrowly scoped upstream issue if maintainers prefer an
   issue reference for the object-model exception before reviewing the PR.

## Suggested Claude Opus Starting Point

Review the prepared change against the confirmed invariant: no OpenCode event
object may enter `FallbackState.currentModel` or `originalModel`. Then inspect
the watchdog lifecycle after `session.idle`, because the current logs show a
separate possibility of completed subagents being retried after completion.
