import { shellEscapeForDoubleQuotedCommand } from "@oh-my-opencode/utils"

import type { TmuxPaneEnvironment } from "../types"

const TMUX_COMMAND_SHELL = "/bin/sh"
const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export const TMUX_BACKEND_MISMATCH_ERROR = "tmux backend no longer matches the resolved executable"
export const TMUX_PANE_ENVIRONMENT_UNSAFE_ERROR = "pane environment cannot be safely omitted under cmux"

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
  const escapedDescription = shellEscapeForDoubleQuotedCommand(description)
  return `${TMUX_COMMAND_SHELL} -c "printf '%s\\n%s\\n' \\"OMO subagent pane ready: ${escapedDescription}\\" \\"Focus this pane to attach.\\"; while :; do sleep 86400; done"`
}

export function buildTmuxEnvironmentArgs(environment: TmuxPaneEnvironment): string[] {
  return Object.entries(environment)
    .filter(([, value]) => value !== "")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .flatMap(([name, value]) => ["-e", `${name}=${value}`])
}

export function canOmitTmuxPaneEnvironment(
  environment: TmuxPaneEnvironment,
  ambientEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return Object.entries(environment).every(([name, value]) => value === "" && !ambientEnvironment[name])
}

export type TmuxPaneEnvironmentPlan = {
  readonly args: string[]
  readonly clearedNames: string[]
  readonly isCmux: boolean
}

export function planTmuxPaneEnvironment(
  environment: TmuxPaneEnvironment,
  isCmux: boolean,
): TmuxPaneEnvironmentPlan | null {
  const entries = Object.entries(environment)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  if (entries.some(([name]) => !ENVIRONMENT_VARIABLE_NAME_PATTERN.test(name))) return null
  if (isCmux && !canOmitTmuxPaneEnvironment(environment)) return null
  return {
    args: isCmux ? [] : buildTmuxEnvironmentArgs(environment),
    clearedNames: entries.flatMap(([name, value]) => value === "" ? [name] : []),
    isCmux,
  }
}

export function applyTmuxPaneEnvironmentToCommand(
  command: string,
  environmentPlan: TmuxPaneEnvironmentPlan,
): string {
  if (environmentPlan.clearedNames.length === 0) return command
  const unsetArguments = environmentPlan.clearedNames.flatMap((name) => ["-u", name]).join(" ")
  return `env ${unsetArguments} -- ${command}`
}

export function buildTmuxPaneShellCommand(environmentPlan: TmuxPaneEnvironmentPlan): string {
  return applyTmuxPaneEnvironmentToCommand(TMUX_COMMAND_SHELL, environmentPlan)
}
