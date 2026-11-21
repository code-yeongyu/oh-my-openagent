# Behaviour evidence (state, flow, transition)

A screen can pass every static capture and still be wrong: a failed read drawn as an empty list, an
error left up after the retry worked, a late response painted over the item the user moved to, a
saved value that is gone after a reload. This file is the procedure behind checklist items H12-H19
and the "State and flow capture" step in `SKILL.md`.

## Scope: pick the cases the change can break

Run the cases the changed code path can reach, not every case on every screen.

| The change touches | Run |
|---|---|
| A read: a list, a detail view, a status, a count | Held, Failed, Switch (when the target can change) |
| A write: save, send, delete, sign in, rename | Held, Failed, Twice, Re-entry |
| Stored or restored state: session, draft, selection, layout, scroll | Re-entry |
| A multi-step flow: onboarding, pairing, checkout, a wizard | Re-entry at each step, Failed on the step that calls out, the first-use walk |
| Copy, colour, spacing only | none; say so in the report |

The expected result comes from the state table (the `frontend` skill's Brief), the requirement, or
an agreed product rule. What the current build happens to do is not the expected result. With no
rule to check against, the item is UNVERIFIED and the report names the missing decision.

## Hold a request, then look

The pending state lasts milliseconds in a normal run, so a capture taken "while loading" is
usually a capture of the settled screen. Hold the response, confirm it is held, then capture.

In a Playwright suite:

```ts
let release!: () => void
const held = new Promise<void>((resolve) => { release = resolve })
let seen!: () => void
const intercepted = new Promise<void>((resolve) => { seen = resolve })

await page.route("**/api/items**", async (route) => {
  seen()
  await held
  await route.continue()          // or route.fulfill({ status: 500 }) for the Failed case
})

await page.getByRole("button", { name: "Refresh" }).click()
await intercepted                 // the request really left and really is held
// capture: the pending text, what is locked, typed input, selection, focus, scroll, the working region's box
release()
// wait for the state that says it settled, then capture again
```

Confirm the intercept fired before trusting the pending capture: a service worker or a different
transport can carry the request around the route. On the owned engine omowright's
`createRoutes(page)` does the same (the `browser` skill's `references/owned-engine/network.md`): a
handler that awaits your release promise before `continue`, or answers with
`fulfill({ status, body })` or `abort()`. For a packaged desktop app, or any client you cannot
intercept, point it at a fixture server whose handler waits for a release signal. A case you
cannot hold in this environment is UNVERIFIED, with that reason.

Wait for the event or the state, never for a fixed time. A longer sleep, a wider tolerance, or a
changed locator or expected value that turns a red check green hides the defect it found.

## Three kinds of evidence per case

One kind does not stand in for another.

1. **Text and state.** The title, count, selected value, button label and enabled state, typed
   input, focus, and the absence of the previous state's notice.
2. **What the user can see.** The element inside the viewport and not covered. A locator's
   "visible" is true for an element that is covered, transparent or scrolled out of view, so read
   its box against the viewport and what is on top of it, or capture the region.
3. **What happened.** The requests sent (count and target) and the stored result. A success
   notice is not a saved result: read the value back, or reload.

## Keep and clear

For each transition name what must stay and what must go, then read the values at three moments:
before the action, while the request is held, after it settles. Two matching end points can hide
a jump in between.

| Must stay | How to read it |
|---|---|
| Selected item | the selected id or the `aria-selected` row |
| Typed input | the field's value |
| Focus | `document.activeElement` |
| Scroll position | `scrollTop` of the scroller |
| The region being worked in | `getBoundingClientRect()` of the toolbar, composer or row |

| Must go | Read it as |
|---|---|
| The previous spinner or "loading" text | absent, not merely hidden behind the new content |
| The previous error | absent after the retry succeeds |
| The previous success notice | absent once the next action starts |
| The previous form or dialog | closed, and not reopened by a late response |

A move the user asked for (opening a sidebar, expanding a row) is not a defect. Check that it
lands inside the designed layout and that it did not reset input or selection on the way.

## Switch: a late response and the wrong target

1. Start a request for item A and hold it.
2. Move to item B (another row, account, project, tab or session) and let B load.
3. Release A.
4. The screen still shows B's data, B's selection and no dialog or error that belongs to A.

Checking only that "the last response is on screen" misses this, because A is the last response.
A fake that answers in call order cannot show it either.

## Re-entry

After the action settles, come back the way a user would and capture each:

- reload the page, or quit and restart a desktop app
- close the item and open it again from its normal entry point
- back, then forward
- the deep link, opened cold
- a second window or device, when the product syncs

The same state, data and controls are there. Nothing saved is gone, nothing discarded is back, and
a control that was there before (Send, Reopen, the row menu) is there again.

## Twice, and leaving

- Press the action again while the first request is held: one request leaves, or the second is
  refused with a reason on screen.
- After a refusal, press retry: a new request leaves. A retry that does nothing is a defect.
- Leave mid-request (navigate away, close the dialog, close the window): the write either
  completed or is reported as not done on return. Nothing is lost without a message.
- Every pending indicator ends: success, failure, or a deadline message with a way out.

## The path a user takes

Reach each state by the controls a user has. A route typed into the address bar, an event
dispatched from script, a forced click, or an API call in place of the click proves a different
path, and the entry point you skipped is where the defect lives. When a bypass is needed for
diagnosis, record its result apart from the user path.

Name what the check ran on: the build (packaged app, dev server, fixture page) and the data
(seeded, mocked, real account). The client under test is the real build. A hold or a failure you
inject at the network boundary is the condition of the Held, Failed and Switch cases, not a mock:
that case is EXECUTED. What an injected answer cannot prove is success. A success path answered
by a stub, a mock or a fixture proves the stub: run it once against the real backend and data,
or leave it UNVERIFIED.

Before filing a product finding from a capture, confirm the capture shows what you meant: the
right build loaded, the theme repainted, the locator resolved the control and not its caption. A
finding read off a blank or wrong frame is an `[evidence]` defect and is withdrawn.

## A new check must be able to fail

When you add a behaviour test, put the fault back (revert the fix, or inject the defect in an
isolated copy) and watch the test fail for that reason. A timeout or an unrelated error is not a
detection. A test that passes with the fault present guards nothing: the usual causes are a fake
that drops the call it should record, a loop that skips the element it cannot reach, and a wait
that matches the previous render. Record the three runs: clean, faulted, restored.

An intermittent failure is a defect until it is explained. A pass on retry does not erase the
first failure: keep the first capture and the request log and report both runs.

## First-use walk (H19)

Walk the changed flow one step at a time as someone who has never seen it. At each step:

1. Can they tell what to do now?
2. Can they find where to do it?
3. Can they predict the result from the label?
4. After acting, can they tell whether it worked?

Write down the first control that looks like the right one before pressing it, then compare with
what happened. A control that looks actionable and does nothing (an empty menu, a dead row), a
result that only shows after expanding something, and a label that names the mechanism instead of
the outcome are findings. This is a review, not a user test: report what the screen shows and
what a person could not know from it, and do not report user reactions, rates or quotes nobody
observed.

## Report words

- **EXECUTED**: you ran it and saw it. **TRACED**: you read it in source. Only EXECUTED supports a
  PASS for a rendered behaviour.
- **UNVERIFIED**: the condition could not be produced or observed. Give the reason (no way to hold
  the request, packaged build unavailable, a second device needed, not run in the time budget)
  and who can verify it.
- One cause, one finding: the same cause seen on three screens is one finding with three
  locations.
- Keep what you saw apart from what you think causes it.

## Safety

Use data you created for the check. Do not send, publish, pay, delete or change permissions on
real accounts to produce a state: stop one step short and mark the last step UNVERIFIED. Release
every held request, and remove the test data, servers and tabs you created.
