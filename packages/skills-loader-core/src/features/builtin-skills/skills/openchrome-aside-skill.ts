import type { BuiltinSkill } from "../types"

const openchromeAsideTemplate = `# Browser Automation

Drive browsers for e2e testing, verification, scraping, screenshots, and any web interaction.

This skill routes through a tiered stack. Detect what is installed, then use the highest available tier. Every tier degrades gracefully: when aside and openchrome are absent, Playwright MCP still works with zero setup.

## Pick a tier

Detect availability once at the start of a browser task:

\`\`\`bash
command -v aside        # tier 1: LLM ask mode (natural-language browser agent)
command -v openchrome || command -v oc   # tier 2: deterministic real Chrome over CDP (CLI binary is oc)
\`\`\`

Use the first available tier, in order: aside -> openchrome -> Playwright MCP.

### 1. aside (primary - LLM ask mode)

aside is an AI browser. Its ask mode takes a natural-language task and drives a real, logged-in browser end to end. Prefer it for high-level e2e flows such as "sign up, then confirm the dashboard loads".

\`\`\`bash
# Run a browser task in natural language (the LLM ask mode)
aside "Open http://localhost:3000, complete signup with a test account, and confirm the dashboard renders"

# Continue an existing run by session id
aside --session <session-id> "Continue and capture a screenshot of the settings page"

# Choose the account and model explicitly
aside exec --account u1 -m openai-codex/gpt-5.5 "Summarize the current page"
\`\`\`

For deterministic, Playwright-like steps (open a tab, read the DOM, screenshot) use the REPL:

\`\`\`bash
aside repl "const p = await openTab('http://localhost:3000'); await p.screenshot('/tmp/home.png')"
\`\`\`

If aside is not on PATH, install it (see Install) or drop to tier 2.

### 2. openchrome (precision - deterministic real Chrome)

openchrome controls your real, already-logged-in Chrome over CDP. Use it for deterministic clicks, form fills, assertions, and screenshots. The CLI binary is oc.

\`\`\`bash
oc navigate http://localhost:3000
oc run read_page --arg mode=dom --json                        # structured page state
oc run page_screenshot --arg path=/tmp/shot.png
oc run validate_page --arg url=http://localhost:3000 --json   # console errors + health summary
oc click <ref>
\`\`\`

openchrome also exposes an MCP server. This skill drives openchrome through the oc CLI above; to use its MCP instead, register it globally with npx openchrome-mcp setup --client opencode, then call skill_mcp:

\`\`\`
skill_mcp(mcp_name="openchrome", tool_name="navigate", arguments='{"url":"http://localhost:3000"}')
\`\`\`

If openchrome or oc is not on PATH, install it (see Install) or drop to tier 3.

### 3. Playwright MCP (universal fallback - zero setup)

Always available through npx; use it when neither aside nor openchrome is installed.

\`\`\`
skill_mcp(mcp_name="playwright", tool_name="browser_navigate", arguments='{"url":"http://localhost:3000"}')
skill_mcp(mcp_name="playwright", tool_name="browser_snapshot")
skill_mcp(mcp_name="playwright", tool_name="browser_take_screenshot", arguments='{"filename":"/tmp/shot.png"}')
\`\`\`

To attach Playwright MCP to an already-running Chrome (for example openchrome's, on port 9222), pass a CDP endpoint via cdp_url:

\`\`\`
skill_mcp(mcp_name="playwright", tool_name="browser_navigate", arguments='{"url":"http://localhost:3000"}', cdp_url="http://127.0.0.1:9222")
\`\`\`

## Install

Only the higher tiers need setup; Playwright MCP needs nothing.

\`\`\`bash
# aside (tier 1): install the CLI, then sign in from the Aside app
curl -fsSL https://releases.aside.com/install.sh | bash

# openchrome (tier 2)
npm install -g openchrome-mcp
\`\`\`
`

export const openchromeAsideSkill: BuiltinSkill = {
  name: "playwright",
  description:
    "MUST USE for any browser-related tasks. Browser automation via aside (LLM ask mode) plus openchrome real Chrome, with Playwright MCP fallback - verification, browsing, information gathering, web scraping, testing, screenshots, and all browser interactions.",
  template: openchromeAsideTemplate,
  mcpConfig: {
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest"],
    },
  },
}
