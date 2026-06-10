import type { Platform } from "./session-notification-sender"
import * as sessionNotificationSender from "./session-notification-sender"
import { startBackgroundCheck } from "./session-notification-utils"

export function createSessionNotificationInit() {
  let platform: Platform | null = null
  let defaultSoundPath: string | null = null
  let started = false

  function initialize(): { platform: Platform; defaultSoundPath: string } {
    if (!platform) {
      platform = sessionNotificationSender.detectPlatform()
    }
    if (!defaultSoundPath) {
      defaultSoundPath = sessionNotificationSender.getDefaultSoundPath(platform)
    }
    if (!started) {
      startBackgroundCheck(platform)
      started = true
    }

    return {
      platform,
      defaultSoundPath,
    }
  }

  return {
    initialize,
  }
}
