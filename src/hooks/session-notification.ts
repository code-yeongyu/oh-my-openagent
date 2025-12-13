import type { PluginInput } from "@opencode-ai/plugin"
import { platform } from "os"

interface Todo {
  content: string
  status: string
  priority: string
  id: string
}

interface SessionNotificationConfig {
  title?: string
  message?: string
  playSound?: boolean
  soundPath?: string
  /** Delay in ms before sending notification to confirm session is still idle (default: 1500) */
  idleConfirmationDelay?: number
  /** Skip notification if there are incomplete todos (default: true) */
  skipIfIncompleteTodos?: boolean
  /** Maximum number of sessions to track before cleanup (default: 100) */
  maxTrackedSessions?: number
}

type Platform = "darwin" | "linux" | "win32" | "unsupported"

function detectPlatform(): Platform {
  const p = platform()
  if (p === "darwin" || p === "linux" || p === "win32") return p
  return "unsupported"
}

function getDefaultSoundPath(p: Platform): string {
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

async function sendNotification(
  ctx: PluginInput,
  p: Platform,
  title: string,
  message: string
): Promise<void> {
  const escapedTitle = title.replace(/"/g, '\\"').replace(/'/g, "\\'")
  const escapedMessage = message.replace(/"/g, '\\"').replace(/'/g, "\\'")

  switch (p) {
    case "darwin":
      await ctx.$`osascript -e ${"display notification \"" + escapedMessage + "\" with title \"" + escapedTitle + "\""}`
      break
    case "linux":
      await ctx.$`notify-send ${escapedTitle} ${escapedMessage}`
      break
    case "win32":
      await ctx.$`powershell -Command ${"[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.MessageBox]::Show('" + escapedMessage + "', '" + escapedTitle + "')"}`
      break
  }
}

async function playSound(ctx: PluginInput, p: Platform, soundPath: string): Promise<void> {
  switch (p) {
    case "darwin":
      ctx.$`afplay ${soundPath}`.catch(() => {})
      break
    case "linux":
      ctx.$`paplay ${soundPath}`.catch(() => {
        ctx.$`aplay ${soundPath}`.catch(() => {})
      })
      break
    case "win32":
      ctx.$`powershell -Command ${"(New-Object Media.SoundPlayer '" + soundPath + "').PlaySync()"}`.catch(() => {})
      break
  }
}

async function hasIncompleteTodos(ctx: PluginInput, sessionID: string): Promise<boolean> {
  try {
    const response = await ctx.client.session.todo({ path: { id: sessionID } })
    const todos = (response.data ?? response) as Todo[]
    if (!todos || todos.length === 0) return false
    return todos.some((t) => t.status !== "completed" && t.status !== "cancelled")
  } catch {
    return false
  }
}

export function createSessionNotification(
  ctx: PluginInput,
  config: SessionNotificationConfig = {}
) {
  const currentPlatform = detectPlatform()
  const defaultSoundPath = getDefaultSoundPath(currentPlatform)

  const mergedConfig = {
    title: "OpenCode",
    message: "Agent is ready for input",
    playSound: false,
    soundPath: defaultSoundPath,
    idleConfirmationDelay: 1500,
    skipIfIncompleteTodos: true,
    maxTrackedSessions: 100,
    ...config,
  }

  const notifiedSessions = new Set<string>()
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const sessionActivitySinceIdle = new Set<string>()
  // Track notification execution version to handle race conditions
  const notificationVersions = new Map<string, number>()

  function cleanupOldSessions() {
    const maxSessions = mergedConfig.maxTrackedSessions
    if (notifiedSessions.size > maxSessions) {
      const sessionsToRemove = Array.from(notifiedSessions).slice(0, notifiedSessions.size - maxSessions)
      sessionsToRemove.forEach(id => notifiedSessions.delete(id))
    }
    if (sessionActivitySinceIdle.size > maxSessions) {
      const sessionsToRemove = Array.from(sessionActivitySinceIdle).slice(0, sessionActivitySinceIdle.size - maxSessions)
      sessionsToRemove.forEach(id => sessionActivitySinceIdle.delete(id))
    }
    if (notificationVersions.size > maxSessions) {
      const sessionsToRemove = Array.from(notificationVersions.keys()).slice(0, notificationVersions.size - maxSessions)
      sessionsToRemove.forEach(id => notificationVersions.delete(id))
    }
  }

  function cancelPendingNotification(sessionID: string) {
    const timer = pendingTimers.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      pendingTimers.delete(sessionID)
    }
    sessionActivitySinceIdle.add(sessionID)
    // Increment version to invalidate any in-flight notifications
    notificationVersions.set(sessionID, (notificationVersions.get(sessionID) ?? 0) + 1)
  }

  function markSessionActivity(sessionID: string) {
    cancelPendingNotification(sessionID)
    notifiedSessions.delete(sessionID)
  }

  async function executeNotification(sessionID: string, version: number) {
    pendingTimers.delete(sessionID)

    // Race condition fix: check if version matches (activity happened during async wait)
    if (notificationVersions.get(sessionID) !== version) {
      return
    }

    if (sessionActivitySinceIdle.has(sessionID)) {
      sessionActivitySinceIdle.delete(sessionID)
      return
    }

    if (notifiedSessions.has(sessionID)) return

    if (mergedConfig.skipIfIncompleteTodos) {
      const hasPendingWork = await hasIncompleteTodos(ctx, sessionID)
      // Re-check version after async call (race condition fix)
      if (notificationVersions.get(sessionID) !== version) {
        return
      }
      if (hasPendingWork) return
    }

    if (notificationVersions.get(sessionID) !== version) {
      return
    }

    notifiedSessions.add(sessionID)

    try {
      await sendNotification(ctx, currentPlatform, mergedConfig.title, mergedConfig.message)

      if (mergedConfig.playSound && mergedConfig.soundPath) {
        await playSound(ctx, currentPlatform, mergedConfig.soundPath)
      }
    } catch {}
  }

  return async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (currentPlatform === "unsupported") return

    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.updated" || event.type === "session.created") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.id as string | undefined
      if (sessionID) {
        markSessionActivity(sessionID)
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      if (notifiedSessions.has(sessionID)) return
      if (pendingTimers.has(sessionID)) return

      sessionActivitySinceIdle.delete(sessionID)
      
      const currentVersion = (notificationVersions.get(sessionID) ?? 0) + 1
      notificationVersions.set(sessionID, currentVersion)

      const timer = setTimeout(() => {
        executeNotification(sessionID, currentVersion)
      }, mergedConfig.idleConfirmationDelay)

      pendingTimers.set(sessionID, timer)
      cleanupOldSessions()
      return
    }

    if (event.type === "message.updated" || event.type === "message.created") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      if (sessionID) {
        markSessionActivity(sessionID)
      }
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID) {
        markSessionActivity(sessionID)
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        cancelPendingNotification(sessionInfo.id)
        notifiedSessions.delete(sessionInfo.id)
        sessionActivitySinceIdle.delete(sessionInfo.id)
        notificationVersions.delete(sessionInfo.id)
      }
    }
  }
}
