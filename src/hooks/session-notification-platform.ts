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

interface Todo {
  content: string
  status: string
  priority: string
  id: string
}

export type Platform = "darwin" | "linux" | "win32" | "unsupported"

export function detectPlatform(): Platform {
  const p = platform()
  if (p === "darwin" || p === "linux" || p === "win32") return p
  return "unsupported"
}

export function getDefaultSoundPath(p: Platform): string {
  switch (p) {
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

export async function sendNotification(
  ctx: PluginInput,
  p: Platform,
  title: string,
  message: string
): Promise<void> {
  switch (p) {
    case "darwin": {
      const osascriptPath = await getOsascriptPath()
      if (!osascriptPath) return

      const esTitle = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      const esMessage = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      await ctx.$`${osascriptPath} -e ${"display notification \"" + esMessage + "\" with title \"" + esTitle + "\""}`.catch(() => {})
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

      const psTitle = title.replace(/'/g, "''")
      const psMessage = message.replace(/'/g, "''")
      const toastScript = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$Template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$RawXml = [xml] $Template.GetXml()
($RawXml.toast.visual.binding.text | Where-Object {$_.id -eq '1'}).AppendChild($RawXml.CreateTextNode('${psTitle}')) | Out-Null
($RawXml.toast.visual.binding.text | Where-Object {$_.id -eq '2'}).AppendChild($RawXml.CreateTextNode('${psMessage}')) | Out-Null
$SerializedXml = New-Object Windows.Data.Xml.Dom.XmlDocument
$SerializedXml.LoadXml($RawXml.OuterXml)
$Toast = [Windows.UI.Notifications.ToastNotification]::new($SerializedXml)
$Notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('OpenCode')
$Notifier.Show($Toast)
`.trim().replace(/\n/g, "; ")
      await ctx.$`${powershellPath} -Command ${toastScript}`.catch(() => {})
      break
    }
  }
}

export async function playSound(ctx: PluginInput, p: Platform, soundPath: string): Promise<void> {
  switch (p) {
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
      ctx.$`${powershellPath} -Command ${"(New-Object Media.SoundPlayer '" + soundPath.replace(/'/g, "''") + "').PlaySync()"}`.catch(() => {})
      break
    }
  }
}

export async function hasIncompleteTodos(ctx: PluginInput, sessionID: string): Promise<boolean> {
  try {
    const response = await ctx.client.session.todo({ path: { id: sessionID } })
    const todos = (response.data ?? response) as Todo[]
    if (!todos || todos.length === 0) return false
    return todos.some((t) => t.status !== "completed" && t.status !== "cancelled")
  } catch {
    return false
  }
}
