import { describe, expect, it } from "bun:test"
import { gate } from "./one_request_one_thread"
import { eventOf, repaired } from "./testing"
import type { RouteIntent } from "./types"

function route(overrides: Parameters<typeof eventOf>[0] = {}): RouteIntent {
  return { event: eventOf(overrides), unit: null, session_key: null, open_work_item: false }
}

describe("one_request_one_thread gate", () => {
  it("#given a reply inside a thread #when run #then it routes normally", async () => {
    const reply = route({ kind: "thread_reply", key: { platform: "slack", account_id: "T000TEST", chat_id: "C000WORK", thread_id: "M000ROOT" } })
    expect(await gate.run(reply, {}, {})).toEqual({ ok: true })
  })

  it("#given a top-level human message in the scoped chat #when run #then it opens a work item", async () => {
    expect(repaired(await gate.run(route(), {}, {})).open_work_item).toBe(true)
  })
})
