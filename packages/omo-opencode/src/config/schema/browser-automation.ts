import { z } from "zod"

export const BrowserAutomationProviderSchema = z.enum([
  "playwright",
  "agent-browser",
  "dev-browser",
  "playwright-cli",
  "openchrome-aside",
])

export const BrowserAutomationConfigSchema = z.object({
  /**
   * Browser automation provider to use for the "playwright" skill.
   * - "openchrome-aside": Tiered stack - aside LLM ask mode (primary) + openchrome real-Chrome
   *   precision, with graceful fallback to Playwright MCP when aside/openchrome are not installed - default
   * - "playwright": Uses Playwright MCP server (@playwright/mcp)
   * - "agent-browser": Uses Vercel's agent-browser CLI (requires: bun add -g agent-browser)
   * - "dev-browser": Uses dev-browser skill with persistent browser state
   * - "playwright-cli": Uses Playwright CLI (@playwright/cli) - token-efficient CLI alternative
   */
  provider: BrowserAutomationProviderSchema.default("openchrome-aside"),
})

export type BrowserAutomationProvider = z.infer<
  typeof BrowserAutomationProviderSchema
>
export type BrowserAutomationConfig = z.infer<typeof BrowserAutomationConfigSchema>
