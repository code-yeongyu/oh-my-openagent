/** Input delivery: `background` targets the window without focusing it; `foreground` briefly activates it. */
type ComputerDelivery = "background" | "foreground"

/** Options shared by every native input helper. */
interface ComputerDeliveryOptions {
  delivery?: ComputerDelivery
}

/** A bounded hold; input is always released before the call settles. */
interface ComputerHoldOptions extends ComputerDeliveryOptions {
  /** Finite seconds in 0..=100; cancellation or a safety stop may end it early. */
  readonly duration: number
}

interface ComputerHoldMouseOptions extends ComputerHoldOptions {
  readonly button?: "left" | "right" | "middle"
  readonly keys?: readonly string[]
  readonly frameId?: string
}

/** Options for pointer clicks. */
interface ComputerClickOptions extends ComputerDeliveryOptions {
  button?: "left" | "right" | "middle"
  count?: number
  modifiers?: string[]
}

/** Options for pointer drags. */
interface ComputerDragOptions extends ComputerDeliveryOptions {
  modifiers?: string[]
}

/** Options for wheel scrolling at the pointer position; `dx`/`dy` are pixels, the same unit on every OS, and one mouse-wheel notch is about 40 px (so `dy: 120` scrolls about three notches). The direction is semantic and the same on every OS: a positive `dy` moves the view toward the end of the content (the content moves up) and a positive `dx` toward its right edge, regardless of the user's natural-scrolling setting. */
interface ComputerScrollOptions extends ComputerDeliveryOptions {
  dx?: number
  dy?: number
}

/** Options for capturing a screenshot; `silent` skips the auto-displayed image. */
interface ComputerScreenshotOptions {
  silent?: boolean
  /** Zoom rejects an id other than this target's latest full screenshot. */
  frameId?: string
}

/** Region in the last full screenshot's pixels; zoom pixels are not input coordinates. */
interface ComputerCaptureRegion {
  x: number
  y: number
  width: number
  height: number
}

/** Options for an accessibility-tree snapshot. */
interface ComputerAxOptions {
  /** Include nodes that are normally pruned as non-interactive. */
  all?: boolean
  maxDepth?: number
  maxNodes?: number
  /** Only nodes changed after this snapshot generation. */
  since?: number
}

/** A state `computer.verify` polls for with read calls. */
type ComputerExpectation =
  | { kind: "elementExists"; ref: string; exists?: boolean }
  | { kind: "elementValue"; ref: string; value: string }
  | { kind: "elementEnabled"; ref: string; enabled?: boolean }
  | { kind: "elementSelected"; ref: string; selected?: boolean }
  | { kind: "windowExists"; window: string | ComputerWindowFilter }
  | { kind: "windowGone"; window: string | ComputerWindowFilter }
  | { kind: "windowBounds"; window: string | ComputerWindowFilter; bounds: Partial<ComputerBounds>; tolerance?: number }

/** `satisfied` before the deadline, `unsatisfied` at it, or `unknown` when a read failed. */
interface ComputerVerdict {
  status: "satisfied" | "unsatisfied" | "unknown"
  reads: number
  elapsedMs: number
  cause?: string
}

/** One window capture and AX snapshot, committed together. */
interface ComputerObserveOptions extends ComputerScreenshotOptions, ComputerAxOptions {}

interface ComputerObserveResult extends ComputerScreenshotResult {
  ax: string
  nodeCount: number
  truncated: boolean
}

/** Accessibility query matched against role, title, and value. */
interface ComputerAxQuery {
  role?: string
  title?: string
  value?: string
  limit?: number
}

/** Window filter matched case-insensitively against the owning app name and title. */
interface ComputerWindowFilter {
  app?: string
  title?: string
}

/** Rectangle in global logical desktop coordinates. */
interface ComputerBounds {
  x: number
  y: number
  width: number
  height: number
}

/** A native menu item snapshot; selection revalidates the command before dispatch. */
interface ComputerMenuItem {
  title: string
  path: string[]
  enabled: boolean
  checked: boolean
  hasSubmenu: boolean
  shortcut?: string | null
}

/** One capturable top-level window in global logical desktop coordinates. */
interface ComputerWindowInfo extends ComputerBounds {
  /** Opaque backend-defined id; never parse it. */
  id: string
  app: string
  title: string
  pid?: number | null
  focused: boolean
  /** Windows only: the window belongs to an elevated process, so input into it is refused. */
  elevated?: boolean | null
}

/** Monitor geometry in desktop coordinates and `display("all")` composite pixels, not the active capture. */
interface ComputerDisplay extends ComputerBounds {
  id: string
  name: string
  scale: number
  pixelX: number
  pixelY: number
  pixelWidth: number
  pixelHeight: number
  isPrimary: boolean
}

/** One capture; later pointer `x`/`y` on the same target are pixels of this frame. */
interface ComputerScreenshotResult {
  target: string
  frameId: string
  /** Emitted image size. */
  width: number
  height: number
  /** Captured size before downscaling. */
  sourceWidth: number
  sourceHeight: number
  /** Input coordinates remain in the last full screenshot, including after zoom. */
  coordinateWidth: number
  coordinateHeight: number
  region?: ComputerCaptureRegion
  scale: number
  /** Full-resolution artifact, when the engine wrote one. */
  path?: string
}

/** Native desktop backend, permission state, and safety facts. */
interface ComputerCapabilities {
  /** Active native backend identifier. */
  backend: string
  /** Linux display-server kind when applicable. */
  displayServer?: string | null
  capture: boolean
  input: boolean
  /** Whether OS accessibility automation is available. */
  ax: boolean
  /** Whether input can target a background window. */
  backgroundWindowInput: boolean
  /** Whether the display-only virtual cursor is live now. */
  cursorOverlay: boolean
  deliveryModes: string[]
  capturePermission: string
  inputPermission: string
  axPermission: string
  displayCount: number
  /** Whether foreground delivery restores the previous front window and cursor. */
  focusGuard: boolean
  /** Live stop path: `global` (the user's stop chord), `host-relay`, or `none`; input is refused without one. */
  stopPath: string
  /** Why the stop path is not `global`, when it is not. */
  stopReason?: string | null
  /** Windows mandatory integrity level of the engine process. */
  integrityLevel?: string | null
  /** Input is refused while the screen is locked. */
  screenLocked: boolean
  /** Every display the session can capture is asleep (macOS); captures and input then fail with a note saying so. */
  displayAsleep?: boolean
}

/** Live accessibility element resolved from a snapshot ref; expired refs throw `StaleRef`. */
interface ComputerElement {
  /** Snapshot ref tag, e.g. `e5`. */
  readonly ref: string
  readonly role: string
  readonly nativeRole: string
  readonly title?: string
  readonly description?: string
  readonly enabled: boolean
  readonly focused: boolean
  readonly childCount: number
  value(): Promise<string | undefined>
  setValue(value: string): Promise<ComputerActionResult>
  /** Bounds in global desktop coordinates, or null when the element has none. */
  bounds(): Promise<ComputerBounds | null>
  attributes(): Promise<Record<string, string>>
  actions(): Promise<string[]>
  perform(action: string): Promise<ComputerActionResult>
  /** Perform the element's native press action; needs no screenshot. */
  press(): Promise<ComputerActionResult>
  /** Click the element's center with native input. */
  click(options?: ComputerDeliveryOptions): Promise<ComputerActionResult>
  /**
   * Type into this element without taking the user's focus (macOS): a native text field takes the text through its
   * own selection (`inserted`), any other element takes keys once it holds its app's keyboard focus (`keys`); an
   * element that never takes focus throws `BackgroundUnavailable` (`InputFailed` in the foreground) with nothing typed.
   */
  type(text: string, options?: ComputerDeliveryOptions): Promise<ComputerActionResult<{ method: "inserted" | "keys" }>>
  focus(): Promise<ComputerActionResult>
  parent(): Promise<ComputerElement | null>
  children(): Promise<ComputerElement[]>
}

/** Native input helpers shared by desktop, display, and window targets; `x`/`y` are pixels of that target's latest screenshot. */
interface ComputerInputTarget {
  screenshot(options?: ComputerScreenshotOptions): Promise<ComputerScreenshotResult>
  /** Fresh native-detail crop; later clicks still use the last full screenshot's coordinates. */
  zoom(region: ComputerCaptureRegion, options?: ComputerScreenshotOptions): Promise<ComputerScreenshotResult>
  click(x: number, y: number, options?: ComputerClickOptions): Promise<ComputerActionResult>
  doubleClick(x: number, y: number, options?: Omit<ComputerClickOptions, "count">): Promise<ComputerActionResult>
  move(x: number, y: number): Promise<ComputerActionResult>
  drag(points: Array<[number, number]>, options?: ComputerDragOptions): Promise<ComputerActionResult>
  scroll(x: number, y: number, options?: ComputerScrollOptions): Promise<ComputerActionResult>
  type(text: string, options?: ComputerDeliveryOptions): Promise<ComputerActionResult>
  /** Key chord such as `"cmd+shift+p"` or `["cmd", "shift", "p"]`. */
  press(chord: string | string[], options?: ComputerDeliveryOptions): Promise<ComputerActionResult>
  /** Non-empty keys; press in order and release in reverse on every exit. */
  holdKeys(keys: readonly string[], options: ComputerHoldOptions): Promise<ComputerActionResult>
  /** Uses the latest full frame. No pressed state escapes this call. */
  holdMouse(x: number, y: number, options: ComputerHoldMouseOptions): Promise<ComputerActionResult>
}

/** A display target; `active` resolves focus again on each capture, `all` composites every display. */
interface ComputerDisplayTarget extends ComputerInputTarget {
  readonly id: string
}

/** Window handle resolved by `window`/`focusedWindow`; identity fields are a snapshot taken at resolution. */
interface ComputerWindow extends ComputerInputTarget {
  readonly id: string
  readonly app: string
  readonly title: string
  readonly pid?: number
  readonly bounds: ComputerBounds
  readonly focused: boolean
  raise(): Promise<ComputerActionResult>
  readonly menu: {
    /** Inspect a menu path without activating the application (empty path = the menu bar). */
    items(path?: string[]): Promise<ComputerMenuItem[]>
    /**
     * Select one unambiguous enabled leaf command using the window's native menu context. Background (the
     * default) refuses an app with several windows; `delivery: "foreground"` raises and keys this window, so
     * multi-window apps work, and needs the human-confirmed grant (`computer.control.acquire`) first.
     */
    select(path: string[], options?: { delivery?: "background" | "foreground" }): Promise<ComputerActionResult>
  }
  /** Formatted accessibility tree as one string, one node per line with `[ref=eN]` tags. */
  ax(options?: ComputerAxOptions): Promise<string>
  /** Atomic screenshot and AX text of this window; displays screenshot then AX unless silent. */
  observe(options?: ComputerObserveOptions): Promise<ComputerObserveResult>
  find(query: ComputerAxQuery): Promise<ComputerElement[]>
  ref(ref: string): Promise<ComputerElement | null>
  /** Formatted accessibility tree under one element of this window; the parent snapshot's refs stay valid. */
  drill(ref: string, options?: ComputerAxOptions): Promise<string>
}

/** Desktop helpers of the `computer` facade. */
interface ComputerDesktop extends ComputerInputTarget {
  displays(): Promise<ComputerDisplay[]>
  /** Resolve a display id, `"active"`, or `"all"` without changing the session default (active). */
  display(selector: string): Promise<ComputerDisplayTarget>
  windows(filter?: ComputerWindowFilter): Promise<ComputerWindowInfo[]>
  /** Resolve exactly one window by opaque id or filter; ambiguous filters throw listing candidates. */
  window(selector: string | ComputerWindowFilter): Promise<ComputerWindow>
  focusedWindow(): Promise<ComputerWindow | null>
  /** Element under a global desktop coordinate. */
  elementAt(x: number, y: number): Promise<ComputerElement | null>
  focusedElement(): Promise<ComputerElement | null>
  ref(ref: string): Promise<ComputerElement | null>
  readonly clipboard: {
    read(): Promise<string>
    write(text: string): Promise<ComputerActionResult>
  }
  readonly control: {
    /** Ask the human for the foreground-control grant; returns `{ active }` (false when headless or refused). */
    acquire(options: { reason: string }): Promise<ComputerControlState>
    /** Release the foreground-control grant; belongs in `finally`. */
    release(): Promise<void>
    /** Read the foreground-control grant state. */
    state(): Promise<ComputerControlState>
  }
  /** Native backend capabilities, permission state, stop path, and focus guard. */
  capabilities(): Promise<ComputerCapabilities>
}

/** The foreground-control grant state (#9651). */
interface ComputerControlState {
  active: boolean
  reason?: string | null
  grantedAt?: string | null
}

/** Whether input reached the target, and whether sending the same input again could duplicate it. */
type ComputerDisposition =
  | { readonly delivery: "not_delivered"; readonly retry: "safe" | "after_user" }
  | { readonly delivery: "delivery_uncertain"; readonly retry: "unsafe" | "unknown" }
  | { readonly delivery: "delivered_unverified"; readonly retry: "unsafe" }
  | { readonly delivery: "delivered_verified"; readonly retry: "unsafe" }
  | { readonly delivery: "unknown"; readonly retry: "unknown" }

/** The engine's report of one input action. */
interface ComputerActionReport {
  readonly disposition: ComputerDisposition
  /** Characters, keys or steps delivered out of those requested; `null` when the engine does not count. */
  readonly delivered: { readonly count: number; readonly of: number } | null
  readonly effect: "confirmed" | "unverifiable" | "no_change" | "refused"
  readonly route: "ax" | "background_window" | "background_pid" | "foreground_hid" | null
  readonly hit: { readonly role: string; readonly label: string | null } | null
  readonly focusRestoration: "not_needed" | "restored" | "user_moved_on" | "not_confirmed"
  readonly openedSurfaces: ReadonlyArray<{
    kind: string
    title: string | null
    windowId: string | null
    ref: string | null
  }>
  readonly nextCall: { readonly method: string; readonly args: Readonly<Record<string, unknown>> } | null
  readonly note: string | null
  readonly warning: string | null
  /** Ids of the engine audit events this action emitted. */
  readonly auditIds: readonly string[]
  /** `true` when the engine predates reports: the input was sent but nothing is known about it. */
  readonly legacy: boolean
}

/** What an input helper resolves to: its value plus the engine's report of the input it sent. */
interface ComputerActionResult<T = undefined> {
  readonly value: T
  /** The last input action's report; check `report.disposition.retry` before sending the same input again. */
  readonly report: ComputerActionReport
  /** Every input action's report of this call, in send order. */
  readonly reports: readonly ComputerActionReport[]
  /** The engine audit ids of those reports. */
  readonly auditIds: readonly string[]
  /** The tool call that sent the input; the call's audit records carry it. */
  readonly toolCallId: string
}

/**
 * Session-scoped host-computer facade in JavaScript eval while the `computer` tool is active. Every helper is one
 * `tool.computer(...)` call, so it passes the same permission check as a direct tool call; a multi-step task is a
 * cell that awaits one helper per step.
 */
declare const computer: ComputerDesktop & {
  /** End the persistent desktop session; later calls fail. */
  close(): Promise<void>
  /** Poll read calls until `expectation` holds or `timeoutMs` (default 2000) passes; never sends input. */
  verify(
    expectation: ComputerExpectation,
    options?: { timeoutMs?: number; intervalMs?: number },
  ): Promise<ComputerVerdict>
}
