import { describe, expect, test } from "bun:test"
import { createSessionRecords, EARLY_FRAMES_MAX } from "./session-records"
import type { RpcRecord } from "./types"

const ended = async (records: AsyncIterable<RpcRecord>): Promise<RpcRecord[]> => {
  const seen: RpcRecord[] = []
  for await (const record of records) seen.push(record)
  return seen
}

describe("createSessionRecords before the handle is known", () => {
  test("#given the opened session's start-up record and more of a running session's broadcast than are held #when bound to the opened session #then its record streams and the broadcast was dropped", async () => {
    // given
    const opening = createSessionRecords()
    const busy = createSessionRecords()
    const startup: RpcRecord = { type: "session_opened", sessionId: "rpc-new", durableSessionId: "dur-new" }
    for (const records of [opening, busy]) {
      records.accept(startup)
      for (let n = 0; n <= EARLY_FRAMES_MAX; n += 1)
        records.accept({ type: "message_update", sessionId: "rpc-busy", delta: String(n) })
    }

    // when
    opening.bind("rpc-new")
    busy.bind("rpc-busy")
    opening.end("detached")
    busy.end("detached")

    // then
    expect(await ended(opening.records)).toEqual([{ type: "session_opened", durableSessionId: "dur-new" }])
    expect(await ended(busy.records)).toEqual([])
  })

  test("#given the start-up record of the session being opened #when its durable id is asked before the bind #then the session_opened record names it", () => {
    // given
    const records = createSessionRecords()
    records.accept({ type: "session_opened", sessionId: "rpc-new", durableSessionId: "dur-new" })
    records.accept({ type: "agent_start", sessionId: "rpc-other" })

    // when
    const durable = records.openedDurableId("rpc-new")

    // then
    expect(durable).toBe("dur-new")
  })
})
