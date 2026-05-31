import type { PluginInput } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { platform } from "os"
import { log } from "../shared"
import {
  getCmuxPath,
  getOsascriptPath,
  getNotifySendPath,
  getPowershellPath,
  getAfplayPath,
  getPaplayPath,
  getAplayPath,
  getTerminalNotifierPath,
} from "./session-notification-utils"
import { buildWindowsToastScript, escapeAppleScriptText, escapePowerShellSingleQuotedText } from "./session-notification-formatting"

export type Platform = "darwin" | "linux" | "win32" | "unsupported"

export function detectPlatform(): Platform {
  const detected = platform()
  if (detected === "darwin" || detected === "linux" || detected === "win32") return detected
  return "unsupported"
}

export function getDefaultSoundPath(platform: Platform): string {
  switch (platform) {
    case "darwin":
      return "/System/Library/Sounds/Glass.aiff"
    case "linux":
      return "/usr/share/sounds/freedesktop/stereo/complete.oga"
    case "win32":
      return "C:\\Windows\\Media\\notify.wav"
    default:
      return ""
  }
}

type ShellCommand = Promise<unknown> & {
  quiet?: () => Promise<unknown>
  nothrow?: () => ShellCommand
}

type ShellRunner = NonNullable<PluginInput["$"]>

type ShellFailureMode = "throw" | "nothrow"

let hasLoggedUnavailableShellHelper = false

function getShellRunner(ctx: PluginInput): ShellRunner | undefined {
  // Guard for #4128 + #4061: OpenCode Desktop's Electron sidecar can omit Bun's ctx.$ helper.
  if (typeof ctx.$ === "function") return ctx.$

  if (!hasLoggedUnavailableShellHelper) {
    hasLoggedUnavailableShellHelper = true
    log("[session-notification] ctx.$ unavailable; falling back to child_process.execFile")
  }

  return undefined
}

function logCommandFailure(commandName: string, error: Error | string): void {
  log("[session-notification] notification command failed", {
    commandName,
    error: typeof error === "string" ? error : error.message,
  })
}

function logOperationFailure(operation: string, error: Error | string): void {
  log("[session-notification] notification operation failed", {
    operation,
    error: typeof error === "string" ? error : error.message,
  })
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

async function runNotificationCommand(
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

export async function sendSessionNotification(
  ctx: PluginInput,
  platform: Platform,
  title: string,
  message: string
): Promise<void> {
  try {
    switch (platform) {
      case "darwin": {
        // Try cmux first - native UNUserNotificationCenter, properly attributed
        const cmuxPath = await getCmuxPath()
        if (cmuxPath) {
          try {
            await runNotificationCommand(
              ctx,
              cmuxPath,
              ["notify", "--title", title, "--body", message],
              (shell) => shell`${cmuxPath} notify --title ${title} --body ${message}`,
              "throw"
            )
            break
          } catch (error) {
            if (error instanceof Error) {
              logCommandFailure("cmux", error)
            } else {
              logCommandFailure("cmux", String(error))
            }
          }
        }

        // Try terminal-notifier - deterministic click-to-focus
        const terminalNotifierPath = await getTerminalNotifierPath()
        if (terminalNotifierPath) {
          const bundleId = process.env.__CFBundleIdentifier
          const args = bundleId
            ? ["-title", title, "-message", message, "-activate", bundleId]
            : ["-title", title, "-message", message]
          try {
            await runNotificationCommand(
              ctx,
              terminalNotifierPath,
              args,
              (shell) => bundleId
                ? shell`${terminalNotifierPath} -title ${title} -message ${message} -activate ${bundleId}`
                : shell`${terminalNotifierPath} -title ${title} -message ${message}`,
              "throw"
            )
            break
          } catch (error) {
            if (error instanceof Error) {
              logCommandFailure("terminal-notifier", error)
            } else {
              logCommandFailure("terminal-notifier", String(error))
            }
          }
        }

        // Fallback: osascript (click may open Finder instead of terminal)
        const osascriptPath = await getOsascriptPath()
        if (!osascriptPath) return

        const escapedTitle = escapeAppleScriptText(title)
        const escapedMessage = escapeAppleScriptText(message)
        const appleScript = "display notification \"" + escapedMessage + "\" with title \"" + escapedTitle + "\""
        await runNotificationCommand(
          ctx,
          osascriptPath,
          ["-e", appleScript],
          (shell) => shell`${osascriptPath} -e ${appleScript}`
        )
        break
      }
      case "linux": {
        const notifySendPath = await getNotifySendPath()
        if (!notifySendPath) return

        await runNotificationCommand(
          ctx,
          notifySendPath,
          [title, message],
          (shell) => shell`${notifySendPath} ${title} ${message} 2>/dev/null`
        )
        break
      }
      case "win32": {
        const powershellPath = await getPowershellPath()
        if (!powershellPath) return

        const toastScript = buildWindowsToastScript(title, message)
        await runNotificationCommand(
          ctx,
          powershellPath,
          ["-Command", toastScript],
          (shell) => shell`${powershellPath} -Command ${toastScript}`
        )
        break
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      logOperationFailure("send", error)
    } else {
      logOperationFailure("send", String(error))
    }
  }
}

export async function playSessionNotificationSound(
  ctx: PluginInput,
  platform: Platform,
  soundPath: string
): Promise<void> {
  try {
    switch (platform) {
      case "darwin": {
        const afplayPath = await getAfplayPath()
        if (!afplayPath) return
        await runNotificationCommand(
          ctx,
          afplayPath,
          [soundPath],
          (shell) => shell`${afplayPath} ${soundPath}`
        )
        break
      }
      case "linux": {
        const paplayPath = await getPaplayPath()
        if (paplayPath) {
          await runNotificationCommand(
            ctx,
            paplayPath,
            [soundPath],
            (shell) => shell`${paplayPath} ${soundPath} 2>/dev/null`
          )
        } else {
          const aplayPath = await getAplayPath()
          if (aplayPath) {
            await runNotificationCommand(
              ctx,
              aplayPath,
              [soundPath],
              (shell) => shell`${aplayPath} ${soundPath} 2>/dev/null`
            )
          }
        }
        break
      }
      case "win32": {
        const powershellPath = await getPowershellPath()
        if (!powershellPath) return
        const escaped = escapePowerShellSingleQuotedText(soundPath)
        const soundScript = "(New-Object Media.SoundPlayer '" + escaped + "').PlaySync()"
        await runNotificationCommand(
          ctx,
          powershellPath,
          ["-Command", soundScript],
          (shell) => shell`${powershellPath} -Command ${soundScript}`
        )
        break
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      logOperationFailure("sound", error)
    } else {
      logOperationFailure("sound", String(error))
    }
  }
}
