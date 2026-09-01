import { z } from "zod"

export const BrowserAutomationProviderSchema = z.enum([
  "playwright",
  "agent-browser",
  "dev-browser",
  "playwright-cli",
])

export const BrowserAutomationConfigSchema = z.object({
  /**
   * Browser automation provider to use for the "playwright" skill.
   * - "playwright": Uses Playwright MCP server (@playwright/mcp) - default
   * - "agent-browser": Uses Vercel's agent-browser CLI (requires: bun add -g agent-browser)
   * - "dev-browser": Uses dev-browser skill with persistent browser state
   * - "playwright-cli": Uses Playwright CLI (@playwright/cli) - token-efficient CLI alternative
   */
  provider: BrowserAutomationProviderSchema.default("playwright"),
  /**
   * Extra CLI arguments appended to the default `@playwright/mcp@latest`
   * invocation. Only applied when `provider` is `"playwright"`.
   *
   * The Playwright MCP server defaults to launching the `chrome` channel from
   * a system-wide Chrome install (typically `/opt/google/chrome/chrome` on
   * Linux). In sandboxed environments (containers, dev containers, CI runners,
   * remote coding sandboxes) that binary is often absent, and Playwright's
   * bundled Chromium under `PLAYWRIGHT_BROWSERS_PATH` must be used instead.
   *
   * Common overrides:
   * - `["--headless", "--no-sandbox", "--executable-path", "/path/to/chromium"]`
   *   to point at Playwright's bundled Chromium in a sandboxed container.
   *
   * This option is honored only from user config. Walked project config cannot
   * set raw Playwright process arguments.
   *
   * See https://github.com/microsoft/playwright-mcp for the full flag list.
   */
  playwright_mcp_args: z.array(z.string()).optional(),
})

export type BrowserAutomationProvider = z.infer<
  typeof BrowserAutomationProviderSchema
>
export type BrowserAutomationConfig = z.infer<typeof BrowserAutomationConfigSchema>
