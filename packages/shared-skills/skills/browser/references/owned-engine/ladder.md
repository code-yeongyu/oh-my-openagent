# The escalation ladder

**Two identical failures on the same target mean climb, not retry. A third identical attempt is a
defect.** The failure itself selects the next rung; never pause to ask which.

| Rung | Use | Climb when |
|---|---|---|
| 1. `page.snapshot()` + `page.locator(ref)` | anything with a usable ref | the ref is absent, stale, obscured, or the click lands on the wrong node twice |
| 1b. `snapshotWithLayers(page)` / `describeLayers(page)` | a blocking overlay explains two identical misses | `@layers none`, or the overlay is gone and the click still misses |
| 2. `createCua(page)` coordinates | canvas, extension popups, custom controls, drag surfaces | the click misses, or the screenshot and the coordinates disagree |
| 3. pin the viewport (`emulate(page, "desktop-1440")` / `repinViewport`), redo rung 2 | coordinate drift after a resize, a DPI change, or a foreign tab | coordinates land correctly but the widget still refuses input |
| 4. `createCaptcha(page)` | a challenge is the blocker | it clears and the flow still stalls |
| 5. read the browser log (`browser.close()` surfaces the stdio tail) | a browser-level failure | the log names a cause outside the page |

**Rung 5 ends in a written diagnosis, never a speculative code change.** A missing entitlement, a
dead extension service worker, an unavailable authenticator — none of those is fixed by editing
automation code.

## Pin the viewport before trusting any coordinate

`createCua(page)` acts in viewport pixels. When the render surface and the coordinate space
disagree, every coordinate is off by the same constant and retrying just repeats the miss. Set the
device metrics explicitly (`emulate` applies width, height, `deviceScaleFactor` and touch
together), re-read the page's viewport size, then take a **fresh** `cua.getVisibleScreenshot()`.
Coordinates read off an unpinned screenshot are stale. Pin every page you act on, including tabs
you did not open (`createAgentTabs` re-pins on create).

## Refs

- Refs die on every new snapshot. Pass a ref straight from the latest snapshot; never reuse one
  across snapshots and never put one in a CSS selector.
- Refs stay page-level. A child-frame ref (`f1e3`) still resolves through `page.locator`, so you
  never fetch a frame handle to click inside an iframe.
- Always `compactSnapshot()` before sending a snapshot to a model.

## Challenge widgets

A challenge is an obstacle on the path, not a stop sign: clear it, confirm it cleared, continue.
`createCaptcha(page)` gives three techniques:

- **Checkbox** (the common embedded widgets): the control lives in a nested frame, so
  `captcha.click(bounds)` addresses it by viewport coordinates.
- **Slider / puzzle**: `captcha.drag(from, to, { steps })` with enough intermediate steps that the
  motion reads as human. Raise the step count before you change the endpoints.
- **Text or number**: `captcha.readText(bounds)` OCRs the region — the macOS Vision framework by
  default, or pass your own `ocr` function or a vision model.
- **Image grid**: annotate a screenshot, then click per cell with `createCua`.

**Bounds measured against an unpinned viewport are wrong by a constant offset.** If clicks have
been landing wrong, drop to rung 3 first, then re-read the bounds.

Verify with a fresh snapshot that the challenge is gone. Verification is part of the action, not a
separate optimistic assumption. When every technique fails on a page a real browser passes, the
engine is the variable: relaunch through `connectCloakProfile()`.

## Delegating the pixel loop

Coordinate work and challenge solving are iterative: screenshot, reason, act, verify. When that
loop would consume your own context, delegate the blocked page to a subagent armed with these
references and have it return the post-solve state. Drive it yourself when the flow is short or
the state is already in your hands.
