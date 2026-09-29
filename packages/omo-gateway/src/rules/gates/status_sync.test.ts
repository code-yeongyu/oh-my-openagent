import { describe, expect, it } from "bun:test"
import { gate } from "./status_sync"
import { edit, HEADER_ID, intentOf, post, repaired, THREAD } from "./testing"
import type { GateOp } from "./types"

const ctx = { work_item: { header_message_id: HEADER_ID } }
const reactions: GateOp[] = [
  { op: "unreact", key: THREAD, message_id: HEADER_ID, name: "waiting" },
  { op: "unreact", key: THREAD, message_id: HEADER_ID, name: "done" },
  { op: "unreact", key: THREAD, message_id: HEADER_ID, name: "failed" },
  { op: "react", key: THREAD, message_id: HEADER_ID, name: "working" },
]
const reply = post("\u23F3 12:00: started")
const headerEdit = edit(HEADER_ID, "header with new status line")

describe("status_sync gate", () => {
  it("#given reply + header edit + exactly one status reaction #when run #then it passes", async () => {
    expect(await gate.run(intentOf("status", [reply, headerEdit, ...reactions], { status: "working" }), {}, ctx)).toEqual({ ok: true })
  })

  it("#given an edit-only status change #when run #then it is refused", async () => {
    expect(await gate.run(intentOf("status", [headerEdit, ...reactions], { status: "working" }), {}, ctx)).toEqual({
      refuse: "a status change must append a status reply in the thread (never edit-only)",
    })
  })

  it("#given a status change reacting twice #when run #then the reactions are repaired to exactly one", async () => {
    const doubled: GateOp[] = [reply, headerEdit, { op: "react", key: THREAD, message_id: HEADER_ID, name: "done" }, { op: "react", key: THREAD, message_id: HEADER_ID, name: "working" }]
    const fixed = repaired(await gate.run(intentOf("status", doubled, { status: "working" }), {}, ctx))
    expect(fixed.ops).toEqual([reply, headerEdit, ...reactions])
  })

  it("#given no header edit #when run #then it is refused", async () => {
    expect(await gate.run(intentOf("status", [reply, ...reactions], { status: "working" }), {}, ctx)).toHaveProperty("refuse")
  })
})
