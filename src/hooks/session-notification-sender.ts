import type { PluginInput } from "@opencode-ai/plugin"
import { platform } from "os"
import {
  getOsascriptPath,
  getNotifySendPath,
  getPowershellPath,
  getAfplayPath,
  getPaplayPath,
  getAplayPath,
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

export async function sendSessionNotification(
  ctx: PluginInput,
  platform: Platform,
  title: string,
  message: string
): Promise<void> {
  switch (platform) {
    case "darwin": {
      const osascriptPath = await getOsascriptPath()
      if (!osascriptPath) return

      const escapedTitle = escapeAppleScriptText(title)
      const escapedMessage = escapeAppleScriptText(message)
      await ctx.$`${osascriptPath} -e ${"display notification \"" + escapedMessage + "\" with title \"" + escapedTitle + "\""}`.catch(
        () => {}
      )
      break
    }
    case "linux": {
      const notifySendPath = await getNotifySendPath()
      if (!notifySendPath) return

      await ctx.$`${notifySendPath} ${title} ${message} 2>/dev/null`.catch(() => {})
      break
    }
    case "win32": {
      const powershellPath = await getPowershellPath()
      if (!powershellPath) return

      const toastScript = buildWindowsToastScript(title, message)
      await ctx.$`${powershellPath} -Command ${toastScript}`.catch(() => {})
      break
    }
  }
}

export async function playSessionNotificationSound(
  ctx: PluginInput,
  platform: Platform,
  soundPath: string
): Promise<void> {
  switch (platform) {
    case "darwin": {
      const afplayPath = await getAfplayPath()
      if (!afplayPath) return
      ctx.$`${afplayPath} ${soundPath}`.catch(() => {})
      break
    }
    case "linux": {
      const paplayPath = await getPaplayPath()
      if (paplayPath) {
        ctx.$`${paplayPath} ${soundPath} 2>/dev/null`.catch(() => {})
      } else {
        const aplayPath = await getAplayPath()
        if (aplayPath) {
          ctx.$`${aplayPath} ${soundPath} 2>/dev/null`.catch(() => {})
        }
      }
      break
    }
    case "win32": {
      const powershellPath = await getPowershellPath()
      if (!powershellPath) return
      const escaped = escapePowerShellSingleQuotedText(soundPath)
      ctx.$`${powershellPath} -Command ${("(New-Object Media.SoundPlayer '" + escaped + "').PlaySync()")}`.catch(() => {})
      break
    }
  }
}
