import type { PluginInput } from "@opencode-ai/plugin"
import { sendLinuxSessionNotification } from "./session-notification-linux"
import { logOperationFailure } from "./session-notification-log"
import { sendMacosSessionNotification } from "./session-notification-macos"
import type { Platform } from "./session-notification-platform"
import { sendWindowsSessionNotification } from "./session-notification-windows"

export async function sendSessionNotification(
  ctx: PluginInput,
  platform: Platform,
  title: string,
  message: string
): Promise<void> {
  try {
    switch (platform) {
      case "darwin":
        await sendMacosSessionNotification(ctx, title, message)
        break
      case "linux":
        await sendLinuxSessionNotification(ctx, title, message)
        break
      case "win32":
        await sendWindowsSessionNotification(ctx, title, message)
        break
    }
  } catch (error) {
    if (error instanceof Error) {
      logOperationFailure("send", error)
    } else {
      logOperationFailure("send", String(error))
    }
  }
}
