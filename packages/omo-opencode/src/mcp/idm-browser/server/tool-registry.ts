import { z } from "zod"

const CommonParams = {
  sessionId: z.string().optional(),
  accountId: z.string().default("default"),
}

export const TOOL_DEFINITIONS = [
  {
    name: "browser_navigate",
    description: "Navigate to a URL.",
    inputSchema: z.object({
      ...CommonParams,
      url: z.string().url(),
      waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).default("domcontentloaded"),
    }),
  },
  {
    name: "browser_act",
    description: "Execute a natural-language instruction (Stagehand-style).",
    inputSchema: z.object({
      ...CommonParams,
      instruction: z.string(),
      timeout_ms: z.number().int().positive().default(15_000),
      no_cache: z.boolean().default(false),
    }),
  },
  {
    name: "browser_observe",
    description: "Return AXTree-pruned actionable elements.",
    inputSchema: z.object({ ...CommonParams, query: z.string().optional() }),
  },
  {
    name: "browser_end_session",
    description: "Close the BrowserContext for the given session.",
    inputSchema: z.object({ ...CommonParams }),
  },
  {
    name: "browser_extract",
    description: "Extract main content or selector text/html from the current page.",
    inputSchema: z.object({
      ...CommonParams,
      selector: z.string().optional(),
      attribute: z.string().optional(),
      format: z.enum(["text", "html", "json"]).optional(),
    }),
  },
  {
    name: "browser_extract_network",
    description: "Capture XHR/fetch network calls from a per-session persistent buffer.",
      inputSchema: z.object({
        ...CommonParams,
        filter: z.enum(["all", "xhr", "fetch", "document"]).optional(),
        clear: z.boolean().optional(),
        include_bodies: z.boolean().optional(),
      }),
    },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of the current page or a selector with auto-tile/clip for >7500px.",
    inputSchema: z.object({
      ...CommonParams,
      fullPage: z.boolean().optional(),
      selector: z.string().optional(),
      strategy: z.enum(["tile", "clip", "viewport"]).optional(),
      max_dimension_px: z.number().int().positive().optional(),
    }),
  },
  {
    name: "browser_solve_captcha",
    description: "Detect and attempt to solve a CAPTCHA challenge on the current page.",
    inputSchema: z.object({ ...CommonParams }),
  },
  {
    name: "browser_fill",
    description: "Fill a form field. dispatch:'fill'|'keyboard'|'native' controls how the value is set (keyboard mode triggers Vue/React v-model bindings).",
    inputSchema: z.object({
      ...CommonParams,
      selector: z.string(),
      value: z.string(),
      clear: z.boolean().optional(),
      dispatch: z.enum(["fill", "keyboard", "native"]).optional(),
      delay_ms: z.number().int().nonnegative().optional(),
    }),
  },
  {
    name: "browser_click",
    description: "Click an element by selector.",
    inputSchema: z.object({
      ...CommonParams,
      selector: z.string(),
    }),
  },
  {
    name: "browser_click_at",
    description: "Click at absolute viewport coordinates (x, y). Penetrates cross-origin iframes via the mouse engine.",
    inputSchema: z.object({
      ...CommonParams,
      x: z.number().nonnegative(),
      y: z.number().nonnegative(),
      button: z.enum(["left", "middle", "right"]).optional(),
      modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).optional(),
      humanize: z.boolean().optional(),
      delay_ms: z.number().int().nonnegative().optional(),
    }),
  },
  {
    name: "browser_evaluate",
    description: "Execute arbitrary JavaScript in the page context and return JSON-serializable result.",
    inputSchema: z.object({
      ...CommonParams,
      expression: z.string(),
      arg: z.unknown().optional(),
    }),
  },
  {
    name: "browser_press",
    description: "Press a keyboard key (with optional modifiers and selector focus).",
    inputSchema: z.object({
      ...CommonParams,
      key: z.string(),
      selector: z.string().optional(),
      modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).optional(),
      delay_ms: z.number().int().nonnegative().optional(),
    }),
  },
  {
    name: "browser_list_sessions",
    description: "List active browser sessions in the pool with metadata (URL, title, age, idle time).",
    inputSchema: z.object({ ...CommonParams }),
  },
] as const

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"]
