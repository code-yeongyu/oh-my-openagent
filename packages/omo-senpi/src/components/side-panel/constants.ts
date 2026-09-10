/** Registry symbols for pi-tui's layout contract; `Symbol.for` is what makes duplicated copies interoperate. */
export const PI_TUI_LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node")
export const PI_TUI_VIEWPORT = Symbol.for("@earendil-works/pi-tui/viewport")

/** CLI flag: `--omo-side-panel` / `--no-omo-side-panel` overrides the omo.json setting. */
export const SIDE_PANEL_FLAG = "omo-side-panel"

/** Zero-height widget used only to obtain the live renderer from the host. */
export const SIDE_PANEL_ANCHOR_WIDGET_KEY = "omo-side-panel-anchor"

/** Widget key for the fallback surface, when the layout seam is unavailable. */
export const SIDE_PANEL_WIDGET_KEY = "omo-side-panel"

/** The transcript never shrinks below this; the panel hides instead. */
export const MIN_TRANSCRIPT_COLUMNS = 60

/** Resolved panel width is clamped into this range whatever the config says. */
export const PANEL_MIN_COLUMNS = 32
export const PANEL_MAX_COLUMNS = 80

/** Re-attach attempts are throttled: mode switches can fire several events at once. */
export const REATTACH_THROTTLE_MS = 1_000

/**
 * How many delegated children the column keeps. Twelve rows already claim a quarter of a
 * tall terminal, and a running child is never the one evicted.
 */
export const AGENT_ROW_CAP = 12

/** Tool calls retained for the current exchange; the section shows the most recent few. */
export const TOOL_ROW_CAP = 24

/** Tool rows the column shows before it starts counting the rest as "earlier". */
export const TOOL_VISIBLE_ROWS = 6

/** Repaint cadence while a child is running, so its elapsed time actually ticks. */
export const LIVE_REFRESH_MS = 1_000

/** Git reads sit on the refresh path, so they are given a short leash. */
export const GIT_TIMEOUT_MS = 5_000

/** File rows the column shows before it starts counting the rest. */
export const FILE_VISIBLE_ROWS = 8

/** Floor between git reads, so a burst of tool calls cannot spawn a process per call. */
export const GIT_REFRESH_FLOOR_MS = 2_000
