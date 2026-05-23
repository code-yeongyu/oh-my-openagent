import { shellSingleQuote } from "../../shell-env"

const TMUX_COMMAND_SHELL = "/bin/sh"

function looksLikeOpencodeCommand(value: unknown): value is string {
  return typeof value === "string" && /(^|[/\\])opencode(?:$|[.-])/.test(value)
}

function resolveOpencodeCommand(): string {
  if (process.env.OPENCODE_BIN) {
    return process.env.OPENCODE_BIN
  }
  if (process.env.OPENCODE_BIN_PATH) {
    return process.env.OPENCODE_BIN_PATH
  }
  if (looksLikeOpencodeCommand(process.execPath)) {
    return process.execPath
  }

  const argvCommand = process.argv.find((value) => looksLikeOpencodeCommand(value))
  return argvCommand ?? "opencode"
}

function shellCommandExecutable(value: string): string {
  return value.includes("/") || value.includes("\\") ? shellSingleQuote(value) : value
}

function buildCommandPathPrefix(): string {
  return process.env.PATH ? `PATH=${shellSingleQuote(process.env.PATH)}:$PATH; ` : ""
}

export function buildTmuxAttachCommand(serverUrl: string, sessionId: string, directory: string = process.cwd()): string {
  const attachCommand = [
    shellCommandExecutable(resolveOpencodeCommand()),
    "attach",
    shellSingleQuote(serverUrl),
    "--session",
    shellSingleQuote(sessionId),
    "--dir",
    shellSingleQuote(directory || process.cwd()),
  ].join(" ")
  const retryMessage = shellSingleQuote(`OMO attach not ready for ${sessionId}; retrying in 1s...`)
  const command = `${buildCommandPathPrefix()}while true; do ${attachCommand}; code=$?; if [ "$code" -eq 0 ] || [ "$code" -eq 130 ] || [ "$code" -eq 143 ]; then exit "$code"; fi; printf '%s\\n' ${retryMessage}; sleep 1; done`
  return `${TMUX_COMMAND_SHELL} -c ${shellSingleQuote(command)}`
}

export function buildTmuxPlaceholderCommand(description: string): string {
  const command = `printf '%s\\n%s\\n' ${shellSingleQuote(`OMO subagent pane ready: ${description}`)} ${shellSingleQuote("Attaching automatically when the session is ready.")}; exec tail -f /dev/null`
  return `${TMUX_COMMAND_SHELL} -c ${shellSingleQuote(command)}`
}
