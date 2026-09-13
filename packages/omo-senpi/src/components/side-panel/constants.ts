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

/**
 * Subscription usage. Both vendors expose it as a plain HTTP endpoint and neither pushes
 * updates, so it is polled - and because the quota belongs to an account rather than to a
 * session, every session polling on its own would multiply requests against that same quota.
 * The numbers therefore live in one cache file outside any session.
 */
export const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
export const CLAUDE_PROVIDER = "claude-sdk-oauth"
export const CODEX_PROVIDER = "openai-codex"

/** Window lengths the payloads name only by kind; used to pace the bar's marker. */
export const FIVE_HOUR_MS = 5 * 60 * 60 * 1_000
export const WEEK_MS = 7 * 24 * 60 * 60 * 1_000

/** A usage request sits on a timer, not in front of the render loop, so it gets a short leash. */
export const USAGE_TIMEOUT_MS = 10_000

/** How long a fetch stays announced in the shared cache, so parallel sessions do not stampede. */
export const USAGE_CLAIM_MS = 30_000

/** Nothing is retried harder than once an hour, whatever a retry-after header claims. */
export const USAGE_MAX_BACKOFF_MS = 60 * 60 * 1_000

/**
 * Per-provider freshness. Anthropic's numbers move in five-hour blocks and its endpoint is the
 * stricter of the two, so it is read half as often as Codex's.
 */
export const USAGE_TTL_MS: Readonly<Record<"claude" | "codex", number>> = { claude: 300_000, codex: 150_000 }

/**
 * Anything shorter is not an access token. senpi's generic key resolver hands back a short
 * internal marker for `claude-sdk-oauth`, and Anthropic answers that malformed bearer with a
 * 429 carrying a 48-minute retry-after - a self-inflicted outage worth one length check.
 */
export const MIN_ACCESS_TOKEN_LENGTH = 40
