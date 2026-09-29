import { describe, expect, it } from "bun:test"
import { gate } from "./typing_while_writing"
import { intentOf, post, repaired, THREAD } from "./testing"

const typing = { op: "typing", key: THREAD } as const

describe("typing_while_writing gate", () => {
  it("#given typing right before a post in the same thread #when run #then it passes", async () => {
    expect(await gate.run(intentOf("reply", [typing, post("hi")]), {}, {})).toEqual({ ok: true })
  })

  it("#given typing before a post in another thread and a trailing typing #when run #then both are removed, the post kept", async () => {
    const other = post("hi", { ...THREAD, thread_id: "M000OTHER" })
    const result = await gate.run(intentOf("reply", [typing, other, typing]), {}, {})
    expect(repaired(result).ops).toEqual([other])
  })
})
