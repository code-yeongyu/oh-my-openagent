import type { PluginInput } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { log } from "../shared"

type ShellCommand = Promise<unknown> & {
  quiet?: () => Promise<unknown>
  nothrow?: () => ShellCommand
}

type ShellRunner = NonNullable<PluginInput["$"]>

type ShellFailureMode = "throw" | "nothrow"

let hasLoggedUnavailableShellHelper = false

function getShellRunner(ctx: PluginInput): ShellRunner | undefined {
  if (typeof ctx.$ === "function") return ctx.$

  if (!hasLoggedUnavailableShellHelper) {
    hasLoggedUnavailableShellHelper = true
    log("[session-notification] ctx.$ unavailable; falling back to child_process.execFile")
  }

  return undefined
}

async function runQuiet(command: ShellCommand): Promise<void> {
  if (typeof command.quiet === "function") {
    await command.quiet()
    return
  }

  await command
}

async function runQuietNothrow(command: ShellCommand): Promise<void> {
  const safeCommand = typeof command.nothrow === "function" ? command.nothrow() : command
  if (typeof safeCommand.quiet === "function") {
    await safeCommand.quiet()
    return
  }

  await safeCommand
}

async function runExecFile(commandPath: string, args: readonly string[]): Promise<void> {
  const execFileAsync = promisify(execFile)
  await execFileAsync(commandPath, [...args], { windowsHide: true })
}

export async function runNotificationCommand(
  ctx: PluginInput,
  commandPath: string,
  args: readonly string[],
  shellCommand: (shell: ShellRunner) => ShellCommand,
  shellFailureMode: ShellFailureMode = "nothrow"
): Promise<void> {
  const shell = getShellRunner(ctx)
  if (shell) {
    if (shellFailureMode === "throw") {
      await runQuiet(shellCommand(shell))
      return
    }

    await runQuietNothrow(shellCommand(shell))
    return
  }

  await runExecFile(commandPath, args)
}
