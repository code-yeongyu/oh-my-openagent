import type { Plugin } from "@opencode/plugin"

import { log } from "../shared/logger"
import type { AdapterState } from "./adapter-state"
import { directoryOf, sameDirectory } from "./session-actions"

type V2Context = Plugin.Context

// fix 50 (opencode-v2): the V2 host hands every folder's plugin instance the whole process's event
// stream (the plugin context carries no Location, so the bus does not scope it). V1 hooks assume a
// host-scoped stream, so with N warm folders a single session.error made N runtime-fallback retries
// into one session, each with its own folder's config. Only the folder that owns a session tree may
// react to its events.
//
// Ownership: an instance owns a session when the session tree's root lives in the instance's folder
// (one owner per tree; a child that delegate-task moved elsewhere stays with the folder that created
// it). The folder comes from the session's own record (session.get), never from the event envelope:
// the bus stamps the publisher's location there. Unresolvable sessions fail open (old behaviour) and
// are not cached; resolved answers are cached per session.

const OWNERSHIP_TIMEOUT_MS = 2000
const MAX_PARENT_DEPTH = 8

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function rawEventSessionID(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined
  const data = isRecord(raw.data) ? raw.data : isRecord(raw.properties) ? raw.properties : undefined
  if (!data) return undefined
  if (typeof data.sessionID === "string") return data.sessionID
  for (const key of ["part", "info", "message"]) {
    const nested = data[key]
    if (isRecord(nested) && typeof nested.sessionID === "string") return nested.sessionID
  }
  return undefined
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("session ownership lookup timed out")), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function createSessionOwnership(ctx: V2Context, state?: AdapterState): (raw: unknown) => Promise<boolean> {
  const own = ctx.location?.directory
  const decided = new Map<string, boolean>()
  const reported = new Set<string>()

  const remember = (sessionID: string, owned: boolean): boolean => {
    decided.set(sessionID, owned)
    return owned
  }

  const resolveOwner = async (sessionID: string, depth: number): Promise<boolean | undefined> => {
    const cached = decided.get(sessionID)
    if (cached !== undefined) return cached
    // A child this instance created (and possibly moved elsewhere) is ours.
    if (state?.parentOf(sessionID)) return remember(sessionID, true)
    let info: unknown
    try {
      info = await withTimeout(Promise.resolve(ctx.session.get({ sessionID })), OWNERSHIP_TIMEOUT_MS)
    } catch {
      return undefined
    }
    if (!isRecord(info)) return undefined
    const parentID = typeof info.parentID === "string" ? info.parentID : undefined
    if (parentID && parentID !== sessionID && depth < MAX_PARENT_DEPTH) {
      const parent = await resolveOwner(parentID, depth + 1)
      if (parent !== undefined) return remember(sessionID, parent)
    }
    const directory = directoryOf(info)
    if (typeof directory !== "string" || typeof own !== "string") return undefined
    return remember(sessionID, sameDirectory(directory, own))
  }

  return async function ownsSessionEvent(raw: unknown): Promise<boolean> {
    if (typeof own !== "string" || own.length === 0) return true
    const sessionID = rawEventSessionID(raw)
    if (!sessionID) return true
    const type = isRecord(raw) ? raw.type : undefined
    if (type === "session.deleted") {
      const was = decided.get(sessionID)
      decided.delete(sessionID)
      return was ?? true
    }
    if (type === "session.moved") decided.delete(sessionID)
    const owned = await resolveOwner(sessionID, 0)
    if (owned === false && !reported.has(sessionID)) {
      reported.add(sessionID)
      log("[oh-my-openagent] v2 event skipped: session belongs to another folder", { sessionID, directory: own })
    }
    return owned ?? true
  }
}
