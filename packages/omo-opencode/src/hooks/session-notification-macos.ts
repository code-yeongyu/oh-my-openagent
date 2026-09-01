import type { PluginInput } from "@opencode-ai/plugin"
import { escapeAppleScriptText } from "./session-notification-formatting"
import { logCommandFailure } from "./session-notification-log"
import { runNotificationCommand } from "./session-notification-runner"
import {
  getAfplayPath,
  getCmuxPath,
  getOsascriptPath,
  getTerminalNotifierPath,
} from "./session-notification-utils"

export async function sendMacosSessionNotification(
  ctx: PluginInput,
  title: string,
  message: string
): Promise<void> {
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
      return
    } catch (error) {
      if (error instanceof Error) {
        logCommandFailure("cmux", error)
      } else {
        logCommandFailure("cmux", String(error))
      }
    }
  }

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
      return
    } catch (error) {
      if (error instanceof Error) {
        logCommandFailure("terminal-notifier", error)
      } else {
        logCommandFailure("terminal-notifier", String(error))
      }
    }
  }

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
}

export async function playMacosSessionNotificationSound(ctx: PluginInput, soundPath: string): Promise<void> {
  const afplayPath = await getAfplayPath()
  if (!afplayPath) return
  await runNotificationCommand(
    ctx,
    afplayPath,
    [soundPath],
    (shell) => shell`${afplayPath} ${soundPath}`
  )
}
