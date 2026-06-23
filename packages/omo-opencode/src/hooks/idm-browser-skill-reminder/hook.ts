const REMINDER = `

[idm-browser-playbook reminder]
You just used an idm_browser_* MCP tool. If you have not loaded the
\`idm-browser-playbook\` skill in this session, do so now via:

  Skill(name: "idm-browser-playbook")

The playbook catalogs known pitfalls (Radix UI hitarea overlays, HTML
attribute vs JS property, cross-origin iframes, cookie-banner timing,
hCaptcha trigger timing, OTP polling cadence) and recipes (signup with
temp email, captcha-solve decision tree, scraping vs automation,
identity-stamping handoff). It will save you debugging time. Subsequent
idm_browser_* calls in this session will not re-fire this reminder.

Set IDM_BROWSER_SKILL_REMINDER=false to disable.
`

type ToolExecuteInput = {
  tool: string
  sessionID: string
  callID: string
}

type ToolExecuteOutput = {
  title: string
  output: string
  metadata: unknown
}

type EventInput = {
  event: { type: string; properties?: unknown }
}

export function createIdmBrowserSkillReminderHook() {
  const seenSessions = new Set<string>()

  function isReminderDisabled(): boolean {
    return process.env.IDM_BROWSER_SKILL_REMINDER === "false"
  }

  function isBrowserTool(toolName: string): boolean {
    return toolName.startsWith("idm_browser_browser_") || toolName.startsWith("browser_")
  }

  const toolExecuteAfter = async (input: ToolExecuteInput, output: ToolExecuteOutput) => {
    if (isReminderDisabled()) return
    if (!isBrowserTool(input.tool)) return
    if (seenSessions.has(input.sessionID)) return

    seenSessions.add(input.sessionID)
    output.output += REMINDER
  }

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined
    if (event.type === "session.deleted" || event.type === "session.compacted") {
      const sessionID = (props?.sessionID
        ?? (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (sessionID) {
        seenSessions.delete(sessionID)
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
