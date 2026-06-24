import { log } from "../logger"

type RecentPromptDispatch = {
  readonly source: string
  readonly expiresAt: number
}

const recentPromptDispatches = new Map<string, RecentPromptDispatch>()

function recentDispatchKey(sessionID: string, dedupeKey: string): string {
  return `${sessionID}\0${dedupeKey}`
}

function pruneRecentPromptDispatches(now = Date.now()): void {
  for (const [key, dispatch] of recentPromptDispatches) {
    if (dispatch.expiresAt <= now) {
      recentPromptDispatches.delete(key)
    }
  }
}

export function getRecentPromptDispatch(
  sessionID: string,
  dedupeKey: string,
): RecentPromptDispatch | undefined {
  pruneRecentPromptDispatches()
  return recentPromptDispatches.get(recentDispatchKey(sessionID, dedupeKey))
}

export function rememberRecentPromptDispatch(args: {
  readonly sessionID: string
  readonly dedupeKey: string
  readonly source: string
  readonly holdMs: number
}): void {
  pruneRecentPromptDispatches()
  if (args.holdMs <= 0) {
    return
  }

  recentPromptDispatches.set(recentDispatchKey(args.sessionID, args.dedupeKey), {
    source: args.source,
    expiresAt: Date.now() + args.holdMs,
  })
  log("[prompt-async-gate] remembered semantic prompt dispatch", {
    sessionID: args.sessionID,
    source: args.source,
    holdMs: args.holdMs,
  })
}

export function deleteRecentPromptDispatch(sessionID: string, dedupeKey: string): void {
  recentPromptDispatches.delete(recentDispatchKey(sessionID, dedupeKey))
}

export function clearRecentPromptDispatchesForTesting(): void {
  recentPromptDispatches.clear()
}
