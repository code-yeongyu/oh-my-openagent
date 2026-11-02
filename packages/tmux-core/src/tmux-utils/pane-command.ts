import { withPaneAuth } from "../pane-auth"
export { buildPaneAuthEnvironmentArgs } from "../pane-auth"

const TMUX_COMMAND_SHELL = "/bin/sh"

function shellQuoteForNestedCommand(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/"/g, '\\"')
}

export function buildTmuxAttachCommand(serverUrl: string, sessionId: string, directory: string = process.cwd()): string {
  const escapedUrl = shellQuoteForNestedCommand(serverUrl)
  const escapedSessionId = shellQuoteForNestedCommand(sessionId)
  const escapedDirectory = shellQuoteForNestedCommand(directory || process.cwd())
  const authPrefix = withPaneAuth("").replaceAll("\\", "\\\\").replaceAll("$", "\\$").replaceAll('"', '\\"')
  return `${TMUX_COMMAND_SHELL} -c "${authPrefix}opencode attach ${escapedUrl} --session ${escapedSessionId} --dir ${escapedDirectory}"`
}

const PLACEHOLDER_DESCRIPTION_LIMIT = 2_000
const PANE_TITLE_DESCRIPTION_LIMIT = 20

function withoutNul(value: string): string {
  return value.replaceAll("\0", "")
}

export function escapeTmuxFormat(value: string): string {
  return value.replaceAll("#", "##")
}

export function buildSubagentPaneTitle(description: string): string {
  const shown = withoutNul(description).slice(0, PANE_TITLE_DESCRIPTION_LIMIT)
  return `omo-subagent-${escapeTmuxFormat(shown)}`
}

export function buildTmuxPlaceholderCommand(description: string): string {
  const clean = withoutNul(description)
  const shown = clean.length > PLACEHOLDER_DESCRIPTION_LIMIT ? `${clean.slice(0, PLACEHOLDER_DESCRIPTION_LIMIT)}…` : clean
  const banner = shellQuoteForNestedCommand(`OMO subagent pane ready: ${shown}`)
  const hint = shellQuoteForNestedCommand("Focus this pane to attach.")
  const authPrefix = withPaneAuth("").replaceAll("\\", "\\\\").replaceAll("$", "\\$").replaceAll('"', '\\"')
  return `${TMUX_COMMAND_SHELL} -c "${authPrefix}printf '%s\\n%s\\n' ${banner} ${hint}; while :; do sleep 86400; done"`
}
