# Issue #7338 QA Evidence

## What Was Tested

- A failing-first regression test exercised the internal todo continuation payload when the inherited tool permissions allowed `question`.
- The focused regression test and the complete `todo-continuation-enforcer` suite were run after the fix.
- Repository typechecking and the full build, including shared-skill materialization, were run.
- A direct module driver invoked `injectContinuation()` and inspected the payload accepted by `promptAsync`.
- The real OpenCode server was driven in an isolated XDG sandbox with the local plugin and a local fake model. The probe exercised a plugin-originated internal prompt route and captured the resulting session state.
- A dedicated live-hook probe created a pending todo through the real `todowrite` tool, observed `session.idle` over SSE, and waited for `todo-continuation-enforcer` to dispatch its internal continuation.
- The official tmux TUI smoke and two manual tmux variants were attempted to cover the user-facing TUI surface.

## What Was Observed

- Before the fix, the payload contained `question: true`; the regression test failed with 7 passing tests and 1 failure.
- After the fix, the focused test passed 8 tests and the related suite passed 145 tests across 17 files.
- The direct driver observed `{"question":false,"bash":true}`. Other inherited tools remain enabled while the unsupported interactive question tool is disabled.
- Typechecking passed and the full build ended with `build: all steps completed`.
- The isolated OpenCode server probe reported `RESULT=FIXED`, one plugin initialization, one child session, one terminal stop, and a live internal-prompt route. The real OpenCode database remained at 7,810 sessions before and after.
- The dedicated hook probe recorded an initial user message with `tools.question=1`, one pending todo, an SSE `session.idle` event, and one internal continuation message with `tools.question=0`. The hook log shows the countdown, `source:"todo-continuation-enforcer"`, live-listener dispatch, and successful injection. Its sandbox also left the real database count unchanged.
- The official smoke and standard manual TUI launch did not render within their bounded windows. A third attempt using `opencode --mini` and a longer window rendered the OpenCode composer, displayed the typed `oqaXYZ` sentinel, and then tore down cleanly. The real database count remained unchanged.

## Why It Is Enough

The failing-first test pins the exact issue payload, while the passing hook suite covers surrounding continuation behavior. The dedicated real-server probe covers the exact changed route: an allowed question permission reaches a live session, an incomplete todo makes the session idle, the changed hook fires, and the persisted internal message disables the question tool. Typechecking and the full build cover compilation and packaging. The additional server and TUI probes cover adjacent internal-prompt and user-facing regressions.

## What Was Omitted

- Raw environment dumps and any credential-bearing host configuration were not captured. Machine-local sandbox paths and the ephemeral session identifier were redacted from the reviewer-facing receipts.
- The sandbox used only a local fake model and fake API key, so no provider credentials or external model traffic were involved.
- A screenshot is omitted because the terminal proof was captured as reviewer-readable text in `tui-smoke.txt`.
