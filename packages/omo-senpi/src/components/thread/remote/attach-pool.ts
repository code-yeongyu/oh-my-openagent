import type { AttachResume, DeviceService, RemoteAttach } from "@oh-my-opencode/device-service-core"
import type { JsonObject } from "./ports"

// The one read a session's attach holds: its model catalog (`get_available_models`). The catalog does not change with
// what the session does, so it is held until the attach shows a new snapshot (the host re-established it) or ends, and
// is bounded in age; it only decides an exact provider/id that set_model then confirms (remote-controls.ts). Status and
// transcript reads (`get_state`, `get_messages`) are never held: the engine's in-memory state changes with no record on
// the attach (a live run held isStreaming false for 17 s of a running turn), so they always go to the device.
export const CATALOG_RECORD = "get_available_models"
const CATALOG_MAX_AGE_MS = 600_000

/** One remote session's held catalog; a catalog read that a new snapshot raced is not kept. */
function createCatalogHold(attached: RemoteAttach) {
  let held: { readonly key: string; readonly response: JsonObject; readonly at: number } | undefined
  let snapshots = 0
  attached.onEvent((event) => {
    if (event.kind !== "snapshot") return
    snapshots += 1
    held = undefined
  })
  return {
    snapshots: () => snapshots,
    get: (key: string): JsonObject | undefined => (held !== undefined && held.key === key && Date.now() - held.at <= CATALOG_MAX_AGE_MS ? held.response : undefined),
    keep: (key: string, response: JsonObject, sentAt: number): void => {
      if (sentAt === snapshots) held = { key, response, at: Date.now() }
    },
  }
}

export type PooledSession = { readonly attached: RemoteAttach; readonly catalog: ReturnType<typeof createCatalogHold> }

export type HeldAttach = { readonly session: PooledSession; readonly release: () => void }

// How long an attach nobody holds is kept: a send, then a read of the same session, reuse it (one round trip each, and
// the held catalog), while a watch that stopped long ago no longer pins a remote stream. The catalog's own bound.
export const ATTACH_IDLE_MS = CATALOG_MAX_AGE_MS

type Entry = { readonly opened: Promise<PooledSession>; holders: number; idle?: ReturnType<typeof setTimeout> }

/**
 * One attach per remote session on the port's connection, counted by its holders (ops in flight and watches). When the
 * count reaches 0 the attach is detached after `idleMs`, unless a new holder comes first; one that ends on its own is
 * dropped, so the next holder attaches again. Every attach asks for record seqs (relay daemon #774); `resume` is sent
 * only when this hold opens the attach, and the attach reports whether the service took it.
 */
export function createAttachPool(svc: () => Promise<DeviceService>, idleMs: number = ATTACH_IDLE_MS) {
  const entries = new Map<string, Entry>()
  const hold = async (device: string, sessionId: string, resume?: AttachResume): Promise<HeldAttach> => {
    const key = `${device}\u0000${sessionId}`
    let entry = entries.get(key)
    if (entry === undefined) {
      const opened = svc().then((connected) => connected.attach(device, sessionId, resume === undefined ? { seqs: true } : { resume })).then(
        (attached) => {
          void attached.detached.then(() => { if (entries.get(key)?.opened === opened) entries.delete(key) })
          return { attached, catalog: createCatalogHold(attached) }
        },
        (error: unknown) => { if (entries.get(key)?.opened === opened) entries.delete(key); throw error },
      )
      entry = { opened, holders: 0 }
      entries.set(key, entry)
    }
    const held = entry
    held.holders += 1
    clearTimeout(held.idle)
    let session: PooledSession
    try {
      session = await held.opened
    } catch (error) {
      held.holders -= 1
      throw error
    }
    let released = false
    return {
      session,
      release: () => {
        if (released) return
        released = true
        held.holders -= 1
        if (held.holders > 0 || entries.get(key) !== held) return
        held.idle = setTimeout(() => {
          if (held.holders > 0 || entries.get(key) !== held) return
          entries.delete(key)
          void session.attached.detach().catch(() => {})
        }, idleMs)
        held.idle.unref?.()
      },
    }
  }
  return {
    hold,
    clear: () => { for (const entry of entries.values()) clearTimeout(entry.idle); entries.clear() },
  }
}
