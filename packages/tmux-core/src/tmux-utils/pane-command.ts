import { shellEscapeForDoubleQuotedCommand } from "@oh-my-opencode/utils"

const TMUX_COMMAND_SHELL = "/bin/sh"

// Exit codes that mean the attach TUI itself ended normally (success, SIGINT,
// SIGTERM). Anything else is a failed attach attempt the pane should survive.
const ATTACH_USER_EXIT_CODES = "0|130|143"
const ATTACH_RETRY_DELAY_SECONDS = 2

function quoteNestedValue(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

// Escapes a payload embedded in the outer double-quoted `/bin/sh -c "..."`
// context. `$`, backslashes, backticks, and double quotes survive one round of
// shell parsing (tmux runs the command via default-shell) so the inner shell
// sees the payload verbatim, including intentional expansions like $code.
function escapeForOuterDoubleQuotes(payload: string): string {
  return payload
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/"/g, '\\"')
}

export function buildTmuxAttachCommand(serverUrl: string, sessionId: string, directory: string = process.cwd()): string {
  const escapedUrl = quoteNestedValue(serverUrl)
  const escapedSessionId = quoteNestedValue(sessionId)
  const escapedDirectory = quoteNestedValue(directory || process.cwd())
  const attachOnce = `opencode attach ${escapedUrl} --session ${escapedSessionId} --dir ${escapedDirectory}`
  // Retry failed attaches inside the pane so it never dies blank (#3280).
  const loopBody = [
    attachOnce,
    "code=$?",
    `case $code in ${ATTACH_USER_EXIT_CODES}) exit $code;; esac`,
    `printf '%s\\n' "OMO attach failed (exit $code); retrying in ${ATTACH_RETRY_DELAY_SECONDS}s..."`,
    `sleep ${ATTACH_RETRY_DELAY_SECONDS}`,
  ].join("; ")
  const payload = `while :; do ${loopBody}; done`
  return `${TMUX_COMMAND_SHELL} -c "${escapeForOuterDoubleQuotes(payload)}"`
}

export function buildTmuxPlaceholderCommand(description: string): string {
  const escapedDescription = shellEscapeForDoubleQuotedCommand(description)
  return `${TMUX_COMMAND_SHELL} -c "printf '%s\\n%s\\n' \\"OMO subagent pane ready: ${escapedDescription}\\" \\"Focus this pane to attach.\\"; while :; do sleep 86400; done"`
}

export function buildPaneAuthEnvironmentArgs(): string[] {
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (!password) {
    return []
  }

  const args = ["-e", `OPENCODE_SERVER_PASSWORD=${password}`]
  const username = process.env.OPENCODE_SERVER_USERNAME
  if (username !== undefined) {
    args.push("-e", `OPENCODE_SERVER_USERNAME=${username}`)
  }

  return args
}
