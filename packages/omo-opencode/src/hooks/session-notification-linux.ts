import type { PluginInput } from "@opencode-ai/plugin"
import { runNotificationCommand } from "./session-notification-runner"
import { getAplayPath, getNotifySendPath, getPaplayPath } from "./session-notification-utils"

export async function sendLinuxSessionNotification(
  ctx: PluginInput,
  title: string,
  message: string
): Promise<void> {
  const notifySendPath = await getNotifySendPath()
  if (!notifySendPath) return

  await runNotificationCommand(
    ctx,
    notifySendPath,
    [title, message],
    (shell) => shell`${notifySendPath} ${title} ${message} 2>/dev/null`
  )
}

export async function playLinuxSessionNotificationSound(ctx: PluginInput, soundPath: string): Promise<void> {
  const paplayPath = await getPaplayPath()
  if (paplayPath) {
    await runNotificationCommand(
      ctx,
      paplayPath,
      [soundPath],
      (shell) => shell`${paplayPath} ${soundPath} 2>/dev/null`
    )
    return
  }

  const aplayPath = await getAplayPath()
  if (!aplayPath) return
  await runNotificationCommand(
    ctx,
    aplayPath,
    [soundPath],
    (shell) => shell`${aplayPath} ${soundPath} 2>/dev/null`
  )
}
