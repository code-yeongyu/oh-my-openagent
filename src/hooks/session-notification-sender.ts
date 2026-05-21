import type { PluginInput } from "@opencode-ai/plugin"
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

let hasLoggedUnavailableShellHelper = false

function canRunNotificationCommand(ctx: PluginInput): boolean {
  if (typeof ctx?.$ === "function") return true

  if (!hasLoggedUnavailableShellHelper) {
    hasLoggedUnavailableShellHelper = true
    log("[session-notification] ctx.$ unavailable; skipping notification command execution")
  }

  return false
}

async function runQuietNothrow(command: ShellCommand): Promise<void> {
  const safeCommand = typeof command.nothrow === "function" ? command.nothrow() : command
  if (typeof safeCommand.quiet === "function") {
    await safeCommand.quiet()
    return
  }

  await safeCommand
}

export async function sendSessionNotification(
  ctx: PluginInput,
  platform: Platform,
  title: string,
  message: string
): Promise<void> {
  if (!canRunNotificationCommand(ctx)) return

  switch (platform) {
    case "darwin": {
      // Try cmux first - native UNUserNotificationCenter, properly attributed
      const cmuxPath = await getCmuxPath()
      if (cmuxPath) {
        try {
          await ctx.$`${cmuxPath} notify --title ${title} --body ${message}`.quiet()
          break
        } catch {
        }
      }

      // Try terminal-notifier - deterministic click-to-focus
      const terminalNotifierPath = await getTerminalNotifierPath()
      if (terminalNotifierPath) {
        const bundleId = process.env.__CFBundleIdentifier
        try {
          if (bundleId === "com.mitchellh.ghostty") {
            const escapedTitle = escapeAppleScriptText(title)
            const focusScript = [
              'tell application "Ghostty" to activate',
              'tell application "Ghostty"',
              `  set targetName to "${escapedTitle}"`,
              '  repeat with w in every window',
              '    repeat with t in every tab of w',
              '      if name of t contains targetName then',
              '        select tab t',
              '        set index of w to 1',
              '        return',
              '      end if',
              '    end repeat',
              '  end repeat',
              'end tell',
            ].join("\n")
            const osascriptPath = await getOsascriptPath()
            if (osascriptPath) {
              await ctx.$`${terminalNotifierPath} -title ${title} -message ${message} -execute ${osascriptPath + " -e " + "'" + focusScript + "'"}`.quiet()
            } else {
              await ctx.$`${terminalNotifierPath} -title ${title} -message ${message} -activate ${bundleId}`.quiet()
            }
          } else if (bundleId) {
            await ctx.$`${terminalNotifierPath} -title ${title} -message ${message} -activate ${bundleId}`.quiet()
          } else {
            await ctx.$`${terminalNotifierPath} -title ${title} -message ${message}`.quiet()
          }
          break
        } catch {
        }
      }

      // Fallback: osascript (click may open Finder instead of terminal)
      const osascriptPath = await getOsascriptPath()
      if (!osascriptPath) return

      const escapedTitle = escapeAppleScriptText(title)
      const escapedMessage = escapeAppleScriptText(message)
      await runQuietNothrow(ctx.$`${osascriptPath} -e ${"display notification \"" + escapedMessage + "\" with title \"" + escapedTitle + "\""}`)
      break
    }
    case "linux": {
      const notifySendPath = await getNotifySendPath()
      if (!notifySendPath) return

      await runQuietNothrow(ctx.$`${notifySendPath} ${title} ${message} 2>/dev/null`)
      break
    }
    case "win32": {
      const powershellPath = await getPowershellPath()
      if (!powershellPath) return

      const toastScript = buildWindowsToastScript(title, message)
      await runQuietNothrow(ctx.$`${powershellPath} -Command ${toastScript}`)
      break
    }
  }
}

export async function playSessionNotificationSound(
  ctx: PluginInput,
  platform: Platform,
  soundPath: string
): Promise<void> {
  if (!canRunNotificationCommand(ctx)) return

  switch (platform) {
    case "darwin": {
      const afplayPath = await getAfplayPath()
      if (!afplayPath) return
      await runQuietNothrow(ctx.$`${afplayPath} ${soundPath}`)
      break
    }
    case "linux": {
      const paplayPath = await getPaplayPath()
      if (paplayPath) {
        await runQuietNothrow(ctx.$`${paplayPath} ${soundPath} 2>/dev/null`)
      } else {
        const aplayPath = await getAplayPath()
        if (aplayPath) {
          await runQuietNothrow(ctx.$`${aplayPath} ${soundPath} 2>/dev/null`)
        }
      }
      break
    }
    case "win32": {
      const powershellPath = await getPowershellPath()
      if (!powershellPath) return
      const escaped = escapePowerShellSingleQuotedText(soundPath)
      await runQuietNothrow(ctx.$`${powershellPath} -Command ${"(New-Object Media.SoundPlayer '" + escaped + "').PlaySync()"}`)
      break
    }
  }
}
