import type { PluginInput } from "@opencode-ai/plugin"
import { playLinuxSessionNotificationSound } from "./session-notification-linux"
import { logOperationFailure } from "./session-notification-log"
import { playMacosSessionNotificationSound } from "./session-notification-macos"
import type { Platform } from "./session-notification-platform"
import { playWindowsSessionNotificationSound } from "./session-notification-windows"

export async function playSessionNotificationSound(
  ctx: PluginInput,
  platform: Platform,
  soundPath: string
): Promise<void> {
  try {
    switch (platform) {
      case "darwin":
        await playMacosSessionNotificationSound(ctx, soundPath)
        break
      case "linux":
        await playLinuxSessionNotificationSound(ctx, soundPath)
        break
      case "win32":
        await playWindowsSessionNotificationSound(ctx, soundPath)
        break
    }
  } catch (error) {
    if (error instanceof Error) {
      logOperationFailure("sound", error)
    } else {
      logOperationFailure("sound", String(error))
    }
  }
}
