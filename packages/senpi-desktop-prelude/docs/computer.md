computer → host desktop facade, experimental (present while the `computer` tool is active)
    Drives the REAL desktop: windows, screenshots, native input, OS accessibility (AX), clipboard. Not a browser; no DOM.
    Find it with tool_search ("computer") or call `computer` by name; the global appears in the NEXT cell. The user controls it with `/computer on|off|status|stop|resume`.
    Every helper is one `tool.computer({ action: "call", chain })` call. Permission tiers: inspection needs `computer:read`, input and mutation need `computer:exec`; a denied call throws.
    JS: `await` every helper. Python: sync, same names, keyword args become the trailing options object, `win.raise_()` stands in for `raise`.
computer.displays() → ComputerDisplay[]
computer.windows({ app?, title? }?) → ComputerWindowInfo[]
    Case-insensitive substring match on app and title.
computer.window(idOrFilter) → ComputerWindow
    Exactly one window; zero or several matches throw listing candidates. Handle fields: id, app, title, pid, bounds, focused.
computer.focusedWindow() → ComputerWindow | null
computer.screenshot({ silent? }?) / win.screenshot({ silent? }?) → { target, frameId, width, height, sourceWidth, sourceHeight, scale, path? }
    Auto-displays the image unless `silent: true`.
computer.click(x, y, { button?, count?, modifiers?, delivery? }?) / win.click(...) → None
computer.doubleClick(x, y, opts?) / computer.move(x, y) / computer.drag([[x, y], …], { modifiers?, delivery? }?) / computer.scroll(x, y, { dx?, dy?, delivery? }?) → None
    Same helpers on a window handle: win.doubleClick, win.move, win.drag, win.scroll.
    dx/dy are pixels, the same unit on every OS; one mouse-wheel notch is about 40 px, so dy: 120 scrolls about three notches.
    Scroll direction is semantic and the same on every OS: positive dy moves the view toward the end of the content (negative toward the start), positive dx toward the right edge; the natural-scrolling setting does not change it.
computer.type(text, { delivery? }?) / computer.press("cmd+shift+p" | keys[], { delivery? }?) → None
    Same helpers on a window handle: win.type, win.press.
win.raise() → None
    Brings the window to the front (exec tier). Unavailable on Wayland.
win.ax({ all?, maxDepth? }?) → str
    One formatted TEXT tree, one node per line with `[ref=eN]` tags; NEVER iterate or `.map` it.
win.find({ role?, title?, value?, limit? }) → ComputerElement[]
win.ref("e5") / computer.ref("e5") → ComputerElement | null
computer.elementAt(x, y) / computer.focusedElement() → ComputerElement | null
    `elementAt` takes GLOBAL desktop coordinates, not screenshot pixels.
el.value() / el.bounds() / el.attributes() / el.actions() / el.parent() / el.children() → reads
el.setValue(text) / el.perform(action) / el.press() / el.click({ delivery? }?) / el.focus() → mutations
    Element fields: ref, role, nativeRole, title, description, enabled, focused, childCount. AX actions need no screenshot.
computer.clipboard.read() → str
computer.clipboard.write(text) → None
computer.control.acquire({ reason }) → { active, reason?, grantedAt? }
    Ask the human for the foreground-control grant (exec tier). Headless, refusal, timeout, or interrupt returns { active: false }; a latched stop refuses Suspended. Foreground delivery and win.raise() are refused ControlRequired until this returns { active: true }.
computer.control.release() → None
    Release the grant; belongs in `finally`. Interrupts, task completion, session shutdown, and a failed run also revoke it.
computer.control.state() → { active, reason?, grantedAt? }
computer.run(fnOrCode, { args?, read_only?, timeout? }?) → value
    One multi-step JS run in the persistent desktop session. Functions receive `{ desktop, wait, assert }` (`desktop` = same helpers) and cannot capture cell closures; `args` pass JSON data, functions, RegExp. Python passes a JS code string only. `read_only: true` needs `computer:read` and blocks mutation; `timeout` is seconds. Not sandboxed.
computer.capabilities() → { backend, capture, input, ax, backgroundWindowInput, deliveryModes, *Permission, stopPath, stopReason?, focusGuard, screenLocked, … }
    `stopPath` is `global` when the user's stop chord is armed; with `none`, input is refused. `focusGuard` says whether foreground delivery restores the previous front window and cursor.
computer.close() → None
    Ends the desktop session; later calls fail.
Rules:
    Observe once per turn before interacting with an app (one screenshot or `ax()` of the target), act, then observe again only when you need fresh state; never re-screenshot after every action.
    PREFER AX over pixels: `win.ax()` → `el.press()` / `el.click()` / `el.setValue()`.
    Pointer x,y are pixels in the MOST RECENT screenshot of the SAME target; AX coordinates are global desktop coordinates; NEVER mix them. `InvalidCoordinateFrame` → re-screenshot that target.
    Each `win.ax()` starts a ref generation; current and previous refs stay valid, older refs throw `StaleRef`. Re-snapshot; NEVER guess refs.
    Input defaults to `delivery: "background"`. On macOS it leaves the frontmost app, its focused window, the cursor and the destination of the user's next keystroke unchanged, but a clicked target window may rise directly under the user's front window. `BackgroundUnavailable` means use AX or retry with `delivery: "foreground"` (briefly activates the target, then the focus guard restores it). Never assume a background action landed without re-observing.
    Background keyboard input goes only to an app's SOLE window: typing or pressing keys into a process with several windows throws `BackgroundUnavailable`; use AX `setValue`, or foreground delivery.
    The user's stop chord suspends all input. `Suspended` or `StopPathUnavailable` → stop acting and tell the user; only the user resumes (`/computer resume`).
    FOREGROUND CONTROL: input and `raise()` default to background and need no grant. `delivery: "foreground"` and `win.raise()` require the human-confirmed grant: call `await computer.control.acquire({ reason })` first, and act only when it returns `{ active: true }`; `ControlRequired` means acquire first, `InputBusy` means another session holds the grant (never stolen — continue in the background or retry after release). A failed run revokes the grant, so re-acquire after any error. Release with `computer.control.release()` in `finally`.
    Wayland: no per-window input and no `raise()`; use AX, or desktop input after the user focuses the target.
