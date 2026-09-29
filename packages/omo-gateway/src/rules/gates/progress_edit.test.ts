import { describe, expect, it } from "bun:test"
import { gate } from "./progress_edit"
import { edit, intentOf, post, repaired, THREAD } from "./testing"

describe("progress_edit gate", () => {
  it("#given no progress message yet #when one progress post is sent #then it passes", async () => {
    expect(await gate.run(intentOf("progress", [post("step 1/3")]), {}, {})).toEqual({ ok: true })
  })

  it("#given an existing progress message #when a new progress post is sent #then it becomes an edit with the same text", async () => {
    const result = await gate.run(intentOf("progress", [post("step 2/3")]), {}, { progress_message_id: "M000PROG" })
    expect(repaired(result).ops).toEqual([{ op: "edit", key: THREAD, message_id: "M000PROG", text: "step 2/3" }])
  })

  it("#given an existing progress message #when the update edits another message #then it is refused", async () => {
    expect(await gate.run(intentOf("progress", [edit("M000OTHER", "x")]), {}, { progress_message_id: "M000PROG" })).toHaveProperty("refuse")
  })
})
