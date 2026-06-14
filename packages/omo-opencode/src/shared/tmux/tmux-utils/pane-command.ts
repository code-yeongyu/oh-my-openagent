import { shellEscapeForDoubleQuotedCommand, shellSingleQuote } from "../../shell-env"

const TMUX_COMMAND_SHELL = "/bin/sh"

export function buildTmuxAttachCommand(serverUrl: string, sessionId: string, directory: string = process.cwd()): string {
  const escapedUrl = shellEscapeForDoubleQuotedCommand(serverUrl)
  const escapedSessionId = shellEscapeForDoubleQuotedCommand(sessionId)
  const escapedDirectory = shellEscapeForDoubleQuotedCommand(directory || process.cwd())
  return `${TMUX_COMMAND_SHELL} -c "opencode attach ${escapedUrl} --session ${escapedSessionId} --dir ${escapedDirectory}"`
}

export function buildTmuxPlaceholderCommand(description: string): string {
  const escapedDescription = shellSingleQuote(`OMO subagent pane ready: ${description}`)
  return `${TMUX_COMMAND_SHELL} -c 'printf "%s\\n%s\\n" "$1" "Attaching automatically when ready."; exec tail -f /dev/null' sh ${escapedDescription}`
}
