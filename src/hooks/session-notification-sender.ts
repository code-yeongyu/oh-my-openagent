import type { PluginInput } from "@opencode-ai/plugin"
import {
  playLinuxSessionNotificationSound,
  sendLinuxSessionNotification,
} from "./session-notification-linux"
import { logOperationFailure } from "./session-notification-log"
import {
  playMacosSessionNotificationSound,
  sendMacosSessionNotification,
} from "./session-notification-macos"
import {
  type Platform,
  detectPlatform,
  getDefaultSoundPath,
} from "./session-notification-platform"
import {
  playWindowsSessionNotificationSound,
  sendWindowsSessionNotification,
} from "./session-notification-windows"

export { type Platform, detectPlatform, getDefaultSoundPath }

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
