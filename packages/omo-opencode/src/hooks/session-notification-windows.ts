import type { PluginInput } from "@opencode-ai/plugin"
import {
  buildWindowsToastScript,
  escapePowerShellSingleQuotedText,
} from "./session-notification-formatting"
import { runNotificationCommand } from "./session-notification-runner"
import { getPowershellPath } from "./session-notification-utils"

export async function sendWindowsSessionNotification(
  ctx: PluginInput,
  title: string,
  message: string
): Promise<void> {
  const powershellPath = await getPowershellPath()
  if (!powershellPath) return

  const toastScript = buildWindowsToastScript(title, message)
  await runNotificationCommand(
    ctx,
    powershellPath,
    ["-Command", toastScript],
    (shell) => shell`${powershellPath} -Command ${toastScript}`
  )
}

export async function playWindowsSessionNotificationSound(ctx: PluginInput, soundPath: string): Promise<void> {
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
}
