# State and flow

For a screen that reads or writes over a request, depends on a precondition, keeps saved or
restored state, or runs a multi-step flow. The build rule "a data view ships empty, loading, error
and offline" says which states exist. This file says how to make each one true, and what a change
of state must keep and clear. `/visual-qa` checks the result as H12-H19.

## The state table (write it before the code)

One row per state the changed path can reach. Put it in `DESIGN.md` section 5 beside the screen,
or in the change description when the project has none.

| State, and what decides it | The user sees | Next action offered | Requests that run | Must not show or run | Leaves by |
|---|---|---|---|---|---|
| Unknown: the first read is pending | placeholder for the list | none | the read | "No items", a count of 0 | read settles |
| Unknown: the read failed | "Could not load items" beside the list | Retry | none until retry | the empty state, the old list presented as current | retry |
| Empty: the read returned zero | what belongs here and how to add the first one | Add | none | an error, a retry | add |
| Loaded | the items | the primary action | none | a spinner, the previous error | refresh, select |
| Saving | the form, locked, with the typed values | Cancel when safe | one write | a second write, a success notice | write settles, or a deadline |
| Save failed | the typed values and the cause beside the field or object | Retry or edit | none until retry | "Saved", a cleared form | retry |

Rows that are often missing: unknown (pending and failed), a precondition not met, waiting on
someone else, a conflict with something that already exists, and partial success across several
targets. What decides a state is a stored fact or a response, never a default value: `false`,
`[]`, `0` and `null` before the first answer mean "not known yet".

## Rules for states

- **Unknown is a state.** A read that has not finished or that failed is never drawn as empty,
  zero, signed out, "none" or "not set up". Each of those tells the user something false and
  offers the wrong next action.
- **The message fits the cause.** A missing precondition says what to prepare and where; it does
  not offer Retry, because retrying cannot help. Waiting on another party says who acts and that
  the user has nothing to do. A real failure says so and offers the retry that can work.
- **Every region agrees.** When an action settles, the header, the row, the badge, the count, the
  button label and the toast show the new state, and the previous spinner, error, success notice
  and form are gone. One fact has one owner; regions read it, they do not keep copies.
- **Do not block what still works.** A precondition that stops creating does not stop reading
  what exists. Guard the action, not the page.
- **Keep what the user typed.** A validation failure or a failed save leaves every value in place
  and points at the field to change.
- **A conflict leads somewhere.** "Already exists" or "already pending" opens the existing thing
  or shows its status. It is not turned into success, and it does not invite the same request
  again.
- **Every pending state ends.** Success, failure, or a deadline with a message and a way out. An
  indicator that can say "starting" forever is a defect.

## Rules for requests

- **A response belongs to the request and the target that asked.** Before applying it, check that
  the target (item, account, project, session, route) is still the current one and that no newer
  request for it has been sent. Key caches by target. A late response for a target the user left
  is dropped: it does not update the screen, open a dialog or raise an error there.
- **Cancelling is not undoing.** An aborted request may still have taken effect on the server.
  After a cancel, a timeout or a lost response, read the result back before showing either
  outcome.
- **An optimistic write rolls back only itself.** A rollback restores the value that write
  replaced. It does not overwrite a later edit or a newer confirmed value.
- **One press, one request.** Lock the action while its request is pending, in the handler and not
  only in the button's look. A retry after a refusal sends a new request: a guard keyed on the
  refused attempt's id blocks it.
- **Leaving is a case.** A write still in flight when the user navigates away or closes the window
  either completes or is reported as not done on return.

## Re-entry

The screen is entered more ways than the one you built it from. Check where each piece of state
lives (the server, the URL, local storage, memory) and that these paths restore it:

- reload, and quit and restart for a desktop app
- close and reopen from the normal entry point
- back and forward
- the deep link, opened cold
- a second window or device, when the product syncs
- reconnect after the connection or the host dropped

State held only in memory is gone after the first of these. A control that depends on a live
connection (Send, a row menu, a status) needs its own "reconnecting" state so it does not vanish.

## What a change of state keeps

Server data, request status, the user's selection and input, and view state (an open panel, a
tab) change independently. Keep them in separate values: one combined value resets the user's
work whenever the data refreshes.

Across a refetch or a state change, the selection, typed input, focus and scroll position stay
unless the requirement says otherwise, and the region the user is working in does not move.
Reserve the space a notice or a result will take, and keep the previous data on screen with a
separate progress mark when the same target is refetched. Replace the data at once when the
target changed or the old data must not be shown.

## Reviewing client code for these defects

Follow one user action from the handler through local state, the request, the response and the
render, and read the guards above it before claiming a defect.

| Look at | The defect it produces |
|---|---|
| What each of start, success, rejection and cancel sets | an error turned into an empty success; a success that leaves the old failure up |
| Two inputs with their responses in reverse order; identity checks, abort handling, cache keys | a stale response over the current target; a rollback over a newer edit |
| Effect dependencies and cleanup, timers, subscriptions, listeners, keys | state that outlives its owner; a stale closure acting on the old target |
| Submit, Enter, click, IME composition, paste, autofill; empty, null and omitted values | a double submit; lost input; a field that flips between controlled and not |
| Refs and focus across conditional rendering and unmount | focus lost or sent to the wrong control; a dialog that cannot close |
| Storage errors and quota, server and client initial values, hydration, back and forward, another tab | a screen that differs after reload; a session change another tab never sees |
| Dates and zones, locale, units and ids between display, draft, storage and payload | a value that does not survive a round trip; "no value" turned into 0 |
| The endpoint, the current id and credentials, the error contract, cache invalidation | a call for the wrong resource; a failure that never reaches the screen; a list that stays stale |

Mark each finding as traced in source or executed in a browser. A source trace locates a cause; it
does not prove what the screen shows.

## Tests for these rules

- Put the rule in the fastest layer that can fail for it: transition logic in a unit or component
  test, the wiring in an integration test, the visible result in a browser test.
- Control the order. Hold the response, assert the pending state, then release it; for a race,
  start A, start B, finish B, then finish A, and assert the screen shows B. A fake that answers
  in call order cannot fail this test.
- Wait for the event or the state, never for a fixed time.
- Prove the test can fail: revert the fix and watch it go red for that reason.
- The `visual-qa` skill's `references/behaviour-evidence.md` has the hold recipe and the capture cases.
