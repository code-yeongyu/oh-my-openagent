import type { RpcRecord, RpcSessionEnd } from "./types"

/**
 * One session's view of a multi-session host connection. The host tags a session's records with its routing handle
 * (`sessionId`) and broadcasts other sessions' records on the same connection; records tagged before `open_session`
 * answers belong to the session being opened, so they wait until its handle is known. A command sent here is tagged
 * on the way out, and an untagged `response` to it is routed back by its id.
 */
export type SessionRecords = {
  /** Every host frame that is not the answer to the stream's own requests, in host order. */
  readonly accept: (frame: RpcRecord) => void
  readonly bind: (sessionId: string) => void
  /** The durable id the host's `session_opened` record names for this handle, when one arrived before the answer. */
  readonly openedDurableId: (sessionId: string) => string | undefined
  readonly tag: (record: RpcRecord) => RpcRecord
  readonly end: (reason: RpcSessionEnd) => void
  readonly isEnded: () => boolean
  readonly records: AsyncIterable<RpcRecord>
  readonly ended: Promise<RpcSessionEnd>
}

/**
 * How many tagged frames wait for the handle at most. An open can wait out its whole request timeout while other
 * sessions keep broadcasting; a session being opened writes only its start-up records before the answer, so when the
 * held frames pass this bound the handle holding the most is a running session's, and its frames are dropped for good.
 */
export const EARLY_FRAMES_MAX = 1_024

export function createSessionRecords(): SessionRecords {
  let handle: string | undefined
  let reason: RpcSessionEnd | undefined
  let wake: (() => void) | undefined
  // Accumulators: tagged frames held per handle until the handle is known, and the handles no longer held; ids of
  // commands sent here; records not yet read.
  const early = new Map<string, RpcRecord[]>()
  const dropped = new Set<string>()
  let held = 0
  const forwarded = new Set<string>()
  const queue: RpcRecord[] = []
  const ended = Promise.withResolvers<RpcSessionEnd>()

  const end = (why: RpcSessionEnd): void => {
    if (reason !== undefined) return
    reason = why
    ended.resolve(why)
    wake?.()
  }
  const deliver = (record: RpcRecord): void => {
    if (record.type === "response" && typeof record.id === "string") forwarded.delete(record.id)
    const { sessionId: _routingHandle, ...forClient } = record
    queue.push(forClient)
    wake?.()
  }
  const route = (frame: RpcRecord): void => {
    if (frame.sessionId === handle) {
      if (frame.type === "session_closed" || frame.type === "session_released") return end(frame.type)
      return deliver(frame)
    }
    if (
      frame.sessionId === undefined &&
      frame.type === "response" &&
      typeof frame.id === "string" &&
      forwarded.has(frame.id)
    )
      deliver(frame)
  }
  const hold = (owner: string, frame: RpcRecord): void => {
    if (dropped.has(owner)) return
    const frames = early.get(owner) ?? []
    frames.push(frame)
    early.set(owner, frames)
    held += 1
    if (held <= EARLY_FRAMES_MAX) return
    let largest = owner
    for (const [other, its] of early) if (its.length > (early.get(largest)?.length ?? 0)) largest = other
    held -= early.get(largest)?.length ?? 0
    early.delete(largest)
    dropped.add(largest)
  }
  async function* drain(): AsyncGenerator<RpcRecord> {
    for (;;) {
      const record = queue.shift()
      if (record !== undefined) {
        yield record
        continue
      }
      if (reason !== undefined) return
      await new Promise<void>((resolve) => {
        wake = resolve
      })
      wake = undefined
    }
  }

  return {
    accept: (frame) => {
      if (reason !== undefined) return
      if (handle !== undefined) return route(frame)
      if (typeof frame.sessionId === "string") hold(frame.sessionId, frame)
    },
    openedDurableId: (sessionId) => {
      const opened = early.get(sessionId)?.find((frame) => frame.type === "session_opened")
      const durable = opened?.durableSessionId
      return typeof durable === "string" && durable !== "" ? durable : undefined
    },
    bind: (sessionId) => {
      handle = sessionId
      const own = early.get(sessionId) ?? []
      early.clear()
      dropped.clear()
      for (const frame of own) if (reason === undefined) route(frame)
    },
    tag: (record) => {
      if (typeof record.id === "string") forwarded.add(record.id)
      return { ...record, sessionId: handle }
    },
    end,
    isEnded: () => reason !== undefined,
    records: { [Symbol.asyncIterator]: drain },
    ended: ended.promise,
  }
}
