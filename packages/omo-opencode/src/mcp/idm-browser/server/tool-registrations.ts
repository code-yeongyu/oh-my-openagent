import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { BrowserPool } from "../pool"
import type { ActionCache } from "../primitives"
import { withRecording } from "../recording"
import {
  handleNavigate,
  handleAct,
  handleObserve,
  handleEndSession,
  handleExtract,
  handleExtractNetwork,
  handleScreenshot,
  handleSolveCaptcha,
  handleFill,
  handleClick,
  handleClickAt,
  handleEvaluate,
  handlePress,
  handleListSessions,
} from "./handlers"

export type ToolDeps = {
  getPool: () => Promise<BrowserPool>
  getCache: () => ActionCache
}

function recorded<P extends Record<string, unknown>, R>(
  name: string,
  exec: (params: P) => Promise<R>,
  getPool: () => Promise<BrowserPool>,
): (params: P) => Promise<R> {
  return async (params: P) => {
    const pool = await getPool()
    const sessionId = params.sessionId as string | undefined
    const session = sessionId ? pool.getSession(sessionId) : undefined
    const recordingDir = session?.recordingDir
    
    return withRecording(name, { ...params, recordingDir }, () => exec(params))
  }
}

export function registerBrowserTools(mcp: McpServer, deps: ToolDeps): void {
  const { getPool, getCache } = deps

  mcp.tool("browser_navigate", "Navigate to a URL.", {
    url: z.string().url(),
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
    sessionId: z.string().optional(),
    label: z.string().optional().describe("Recording label to enable enhanced recording layout"),
    engine: z.enum(["camoufox", "cloakbrowser", "patchright", "lightpanda"]).optional().describe("Browser engine to use (switches pool engine)"),
  }, recorded("browser_navigate", async (params) => handleNavigate(await getPool(), params), getPool))

  mcp.tool("browser_act", "Execute a natural-language instruction (Stagehand-style).", {
    instruction: z.string(),
    timeout_ms: z.number().int().positive().optional(),
    no_cache: z.boolean().optional(),
    sessionId: z.string().optional(),
  }, recorded("browser_act", async (params) => handleAct(await getPool(), getCache(), params), getPool))

  mcp.tool("browser_observe", "Return AXTree-pruned actionable elements.", {
    query: z.string().optional(),
    sessionId: z.string().optional(),
  }, recorded("browser_observe", async (params) => handleObserve(await getPool(), params), getPool))

  mcp.tool("browser_end_session", "Close the BrowserContext for the given session.", {
    sessionId: z.string().optional(),
    label: z.string().optional().describe("New label to rename the recording on close"),
  }, recorded("browser_end_session", async (params) => handleEndSession(await getPool(), params), getPool))

  mcp.tool("browser_extract", "Extract main content or selector text/html from the current page.", {
    selector: z.string().optional(),
    attribute: z.string().optional(),
    format: z.enum(["text", "html", "json"]).optional(),
    sessionId: z.string().optional(),
  }, recorded("browser_extract", async (params) => handleExtract(await getPool(), params), getPool))

  mcp.tool("browser_extract_network", "Capture XHR/fetch network calls observed on the current page. Buffer is per-session and persistent — captures every request since the session was created.", {
    filter: z.enum(["all", "xhr", "fetch", "document"]).optional(),
    clear: z.boolean().optional(),
    sessionId: z.string().optional(),
  }, recorded("browser_extract_network", async (params) => handleExtractNetwork(await getPool(), params), getPool))

  mcp.tool("browser_screenshot", "Take a screenshot of the current page or a selector. For fullPage requests larger than max_dimension_px (default 7500), strategy controls behavior: 'tile' splits into multiple images (default), 'clip' takes a single safe-sized image, 'viewport' takes only the visible viewport.", {
    fullPage: z.boolean().optional(),
    selector: z.string().optional(),
    strategy: z.enum(["tile", "clip", "viewport"]).optional(),
    max_dimension_px: z.number().int().positive().optional(),
    sessionId: z.string().optional(),
  }, recorded("browser_screenshot", async (params) => handleScreenshot(await getPool(), params), getPool))

  mcp.tool("browser_solve_captcha", "Detect and attempt to solve a CAPTCHA challenge on the current page.", {
    sessionId: z.string().optional(),
  }, recorded("browser_solve_captcha", async (params) => handleSolveCaptcha(await getPool(), params), getPool))

  mcp.tool("browser_fill", "Fill a form field directly by selector with a literal value. dispatch:'fill' (default) uses Playwright fill, 'keyboard' types char-by-char to trigger framework v-model bindings (Vue/React/Svelte), 'native' fills then explicitly dispatches input/change/blur events.", {
    selector: z.string(),
    value: z.string(),
    clear: z.boolean().optional(),
    dispatch: z.enum(["fill", "keyboard", "native"]).optional(),
    delay_ms: z.number().int().nonnegative().optional(),
    sessionId: z.string().optional(),
  }, recorded("browser_fill", async (params) => handleFill(await getPool(), params), getPool))

  mcp.tool("browser_click", "Click an element directly by selector (bypasses heuristic resolver, exact targeting). Set humanize=true (or env BROWSER_HUMANIZE=true) for curved bezier cursor path with overshoot/hesitate.", {
    selector: z.string(),
    sessionId: z.string().optional(),
    humanize: z.boolean().optional(),
  }, recorded("browser_click", async (params) => handleClick(await getPool(), params), getPool))

  mcp.tool("browser_click_at", "Click at absolute viewport coordinates (x, y) using the underlying mouse engine. Penetrates cross-origin iframes (canonical pattern for hCaptcha image-grid solving and similar widgets where selectors do not reach). Set humanize=true for curved bezier path with jitter; otherwise click is direct with optional delay_ms (defaults to 80..180ms random). modifiers and button forwarded to Playwright.", {
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    sessionId: z.string().optional(),
    button: z.enum(["left", "middle", "right"]).optional(),
    modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).optional(),
    humanize: z.boolean().optional(),
    delay_ms: z.number().int().nonnegative().optional(),
  }, recorded("browser_click_at", async (params) => handleClickAt(await getPool(), params), getPool))

  mcp.tool("browser_evaluate", "Execute arbitrary JavaScript in the page context and return JSON-serializable result. Use to inspect DOM/Vue/React state, dispatch native events, read storage, or call window APIs the heuristic tools cannot reach.", {
    expression: z.string(),
    arg: z.unknown().optional(),
    sessionId: z.string().optional(),
  }, recorded("browser_evaluate", async (params) => handleEvaluate(await getPool(), params), getPool))

  mcp.tool("browser_press", "Press a keyboard key with optional modifiers. If selector is provided, focus that element first. Useful for Enter (submit), Tab (blur/commit), Escape (dismiss).", {
    key: z.string(),
    selector: z.string().optional(),
    modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).optional(),
    delay_ms: z.number().int().nonnegative().optional(),
    sessionId: z.string().optional(),
  }, recorded("browser_press", async (params) => handlePress(await getPool(), params), getPool))

  mcp.tool("browser_list_sessions", "List all active browser sessions in the pool with their metadata (URL, title, age, idle time). Diagnostic tool for pool exhaustion.", {}, recorded("browser_list_sessions", async (params) => handleListSessions(await getPool(), params), getPool))
}
