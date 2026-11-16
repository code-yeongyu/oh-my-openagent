import { eventOf } from "../../../../device-service-core/test/local-api/conformance/fake-owner-state.ts"
import {
  defaultWorld,
  PEER,
  SESSION_ID,
  type World,
  type WorldSession,
} from "../../../../device-service-core/test/local-api/conformance/world.ts"
import type { FakeOwner } from "../../../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { handleOf } from "./seams"
import type { JsonObject } from "./types"

// What the attach and stream rows drive the conformance owner with: a world whose one live session carries the given
// snapshot state, and pushes of the events a host sends on an attach after it opened.

export const THREAD = handleOf(PEER, SESSION_ID)
const WAIT_MS = 5_000

const firstSession = (world: World): WorldSession => {
  const session = world.sessions[0]
  if (session === undefined) throw new Error("the default world has one session")
  return session
}

/** The default world with the session's snapshot state and initial records replaced; delegated commands answered. */
export const worldWith = (state: JsonObject, records: readonly JsonObject[] = []): World => {
  const world = defaultWorld()
  const session = firstSession(world)
  return {
    ...world,
    sessions: [{ ...session, snapshot: { ...session.snapshot, state }, records, delegated: { data: {}, frames: [] } }],
  }
}

/** Sends `kind` with `body` on every attach the owner holds, as its host would after the attach opened. */
export const pushToAttach = (owner: FakeOwner, kind: string, body: JsonObject): void => {
  for (const conn of owner.state.conns)
    for (const attach of conn.attaches) conn.send(eventOf(kind, { attach, ...body }))
}

export const pushRecords = (owner: FakeOwner, records: readonly JsonObject[], attachId = 1): void =>
  pushToAttach(owner, "session.records", { attach_id: attachId, records: [...records] })

/** A re-attach after a relay gap: a new snapshot of the session with `state`. */
export const pushSnapshot = (owner: FakeOwner, state: JsonObject, attachId = 2): void => {
  const snapshot = firstSession(owner.state.world).snapshot
  pushToAttach(owner, "session.snapshot", {
    attach_id: attachId,
    cursor: snapshot.cursor,
    state,
    entries: [...snapshot.entries],
    history_truncated: snapshot.history_truncated,
    oldest_entry_id: snapshot.oldest_entry_id,
  })
}

/** A frame the host's engine writes on this connection's delegated channel toward the session's device. */
export const pushFrame = (owner: FakeOwner, frame: JsonObject): void => {
  for (const conn of owner.state.conns) conn.send(eventOf("session.command_event", { device: PEER, frame }))
}

export const pushDetached = (owner: FakeOwner, reason: string): void =>
  pushToAttach(owner, "session.detached", { reason })

/** Reads a stream one event at a time; each read is bounded so a missing event fails with its name, never hangs. */
export const reader = <E>(stream: AsyncIterable<E>) => {
  const iterator = stream[Symbol.asyncIterator]()
  const next = async (what: string): Promise<E | "done"> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`waited ${WAIT_MS} ms for ${what}`)), WAIT_MS)
    })
    try {
      const result = await Promise.race([iterator.next(), expired])
      return result.done === true ? "done" : result.value
    } finally {
      clearTimeout(timer)
    }
  }
  return { next }
}
