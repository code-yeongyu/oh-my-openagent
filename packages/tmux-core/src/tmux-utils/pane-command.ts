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
  return `${TMUX_COMMAND_SHELL} -c "opencode attach ${escapedUrl} --session ${escapedSessionId} --dir ${escapedDirectory}"`
}

export function buildTmuxPlaceholderCommand(description: string): string {
  const banner = shellQuoteForNestedCommand(`OMO subagent pane ready: ${description}`)
  const hint = shellQuoteForNestedCommand("Focus this pane to attach.")
  return `${TMUX_COMMAND_SHELL} -c "printf '%s\\n%s\\n' ${banner} ${hint}; while :; do sleep 86400; done"`
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
