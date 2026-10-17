# Frames, overlays, dialogs, and the human

## Cross-origin frames and shadow DOM

A cross-origin iframe is a separate target with its own snapshot. `snapshotWithFrames(page)`
reconciles the child trees into the parent so one tree describes the whole page, and reports
`missingFrames` for any it could not enter; address child elements through the page-level ref
(`f1e3`) — never by fetching a frame handle first. Shadow roots are traversed by the snapshot
engine; they are not a special case for you.

## Overlays that swallow clicks

Two identical misses on an element that is clearly visible usually means something invisible sits
on top: a consent banner, a modal backdrop, a sticky header, a full-viewport tracking layer.
`describeLayers(page)` names the topmost fixed or sticky element covering the viewport, and
`snapshotWithLayers(page)` prefixes a snapshot with `@layers blocking=<role> "<name>"` when one
exists. Either the overlay is named — dismiss it and continue — or `@layers none`, which means the
miss has another cause and you climb the ladder instead.

## Dialogs never block

`alert`, `confirm`, `prompt`, and `beforeunload` are answered by the `dialogPolicy` passed to
`connectPipe` (or `browser.setDialogPolicy`), at the protocol layer, before the page sees them.
Default to accepting (`{ accept: true }`; a function receives `{ type, message }` and returns
`{ accept, promptText }`). `page.on("dialog")` still fires for observability. A run that hangs on
an unhandled dialog looks exactly like a hang with no cause, which is the most expensive kind to
diagnose.

## Device emulation

`emulate(page, "iphone-14")` applies viewport, device scale factor, user agent and touch together;
changing only the viewport produces a desktop page at a phone size, which is not what you are
testing. `emulate(page, null)` restores. Re-read the viewport after emulating, and re-pin
coordinates.

## Handing the page to a human

When every rung fails on a login, a one-time code, or a challenge you cannot clear, the human is
the fallback, not the failure:

```js
const { outcome } = await omowright.requestHuman(page, {
  prompt: "Please finish the sign-in in this window.",
  until: { url: /\/dashboard/ },          // or { selector } or async (page) => boolean
  timeoutMs: 300_000,
})
```

It brings the window to the front, shows a banner with a Done button, and waits on a
**condition** with a bounded timeout rather than a fixed delay. Respect the answer: `timed_out`
or `cancelled` is a stop, and the correct response is to report which rung failed with what
evidence. Working around the user's refusal is never correct.
