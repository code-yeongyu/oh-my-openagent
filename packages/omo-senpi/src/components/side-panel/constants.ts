/**
 * Where the host's own URL callback is parked while the panel owns the hook. It is a BOX rather
 * than the bare function because the renderer reaches an extension through a proxy that wraps
 * every function it hands out: reading a function back would gain one wrapper per mount cycle,
 * and the chain would grow with the number of session switches. A plain object is handed back
 * unwrapped, so the true original survives any number of cycles.
 */
export const SIDE_PANEL_PARKED_URL_HOOK = Symbol.for("oh-my-openagent/side-panel/parked-open-url")

/** Registry symbols for pi-tui's layout contract; `Symbol.for` is what makes duplicated copies interoperate. */
export const PI_TUI_LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node")
export const PI_TUI_VIEWPORT = Symbol.for("@earendil-works/pi-tui/viewport")

/** CLI flag: `--omo-side-panel` forces the panel on for one run; there is no `--no-` form, omo.json switches it off. */
export const SIDE_PANEL_FLAG = "omo-side-panel"

/** The named route to the file viewer, registered only when the panel can be on. */
export const SIDE_PANEL_DIFF_COMMAND = "side-panel-diff"

/**
 * The panel's implementation bundle, built beside `omo.js` from `runtime.ts` and imported on the
 * first session that has the panel on, so the entry bundle carries only the registration shell.
 */
export const SIDE_PANEL_RUNTIME_FILE = "omo-side-panel.js"

/** Zero-height widget used only to obtain the live renderer from the host. */
export const SIDE_PANEL_ANCHOR_WIDGET_KEY = "omo-side-panel-anchor"

/** Widget key for the fallback surface, when the layout seam is unavailable. */
export const SIDE_PANEL_WIDGET_KEY = "omo-side-panel"

/** The transcript never shrinks below this; the panel hides instead. */
export const MIN_TRANSCRIPT_COLUMNS = 60

/** Resolved panel width is clamped into this range whatever the config says. */
export const PANEL_MIN_COLUMNS = 32
export const PANEL_MAX_COLUMNS = 80

/**
 * How many delegated children the column keeps. Twelve rows already claim a quarter of a
 * tall terminal, and a running child is never the one evicted.
 */
export const AGENT_ROW_CAP = 12

/** Tool calls retained for the current exchange; the section shows the most recent few. */
export const TOOL_ROW_CAP = 24

/**
 * Columns the goal objective is wrapped to for its viewer. The framed viewer is 70% of the
 * terminal but never narrower than 52 columns, so wrapping at that minimum's inner width is the
 * only width that cannot truncate on a small terminal - and losing the tail of an objective would
 * defeat the click that opened it.
 */
export const GOAL_OBJECTIVE_COLUMNS = 48

/** Diff lines the viewer holds; the rest is counted in one closing row. */
export const DIFF_VIEWER_ROW_CAP = 5_000

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

/**
 * Floor between memory reads. The block costs a park read plus one `readdir` of the facts queue,
 * and both move on the order of minutes - a park transition needs three failed reflection runs,
 * and the queue drains per reflection - so a burst of tool calls must not turn into a directory
 * listing per call.
 */
export const MEMORY_REFRESH_FLOOR_MS = 5_000

/**
 * Columns the memory failure detail is wrapped to for its viewer, for the same reason the goal
 * objective has one: the framed viewer is never narrower than 52 columns.
 */
export const MEMORY_DETAIL_COLUMNS = 48

/**
 * How much of a sidecar's `wakes.ndjson` the panel reads. One settled wake line is bounded at
 * 4 KB, so this always covers dozens of wakes and in practice many more; a longer log is read from
 * its end, and the counts drawn from it are then reported as a floor rather than a total.
 */
export const KIBITZER_WAKES_TAIL_BYTES = 256 * 1024

/**
 * Credential providers per usage section, current name first and the retired spelling behind it.
 * senpi renamed its subscription providers - `claude-sdk-oauth` became `anthropic-subscription`,
 * `openai-codex` became `chatgpt-subscription` - and an install that predates the rename still
 * carries the old key while a migrated one carries the new. Reading a name nobody writes any more
 * is silent: no serving account is found, and the bars fall back to whichever account last reported.
 */
export const CLAUDE_PROVIDERS: readonly string[] = ["anthropic-subscription", "claude-sdk-oauth"]
export const CODEX_PROVIDERS: readonly string[] = ["chatgpt-subscription", "openai-codex"]

/**
 * Anything shorter is not an access token. senpi's generic key resolver hands back a short
 * internal marker for `claude-sdk-oauth`, and Anthropic answers that malformed bearer with a
 * 429 carrying a 48-minute retry-after - a self-inflicted outage worth one length check.
 */
export const MIN_ACCESS_TOKEN_LENGTH = 40
