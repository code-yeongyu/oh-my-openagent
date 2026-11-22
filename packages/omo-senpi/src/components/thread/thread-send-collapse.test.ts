import { afterEach, expect, test } from "bun:test"

import { publishedWorld } from "./published-endpoint-fixture"

// The thread_send tool result is the public contract a sender reads; `collapsed: true` must reach it from the gateway
// (#14431 review L4), or a sender cannot tell that its repeat's text was not delivered.

const worlds: Array<Awaited<ReturnType<typeof publishedWorld>>> = []
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close()
})

test("#given a target mid-turn that took the first alert under a collapse key #when thread_send repeats it #then the tool result says collapsed, with the first delivery id", async () => {
  const world = await publishedWorld()
  worlds.push(world)
  const target = await world.owner("host")
  target.runtime.beginUserTurn()

  const first = await world.send("target", { collapse_key: "alert-1", delivery: "follow_up" })
  const repeat = await world.send("target", { collapse_key: "alert-1", delivery: "follow_up" })

  expect(first).toMatchObject({ kind: "ok", delivery: { kind: "queued" } })
  expect(first).not.toHaveProperty("collapsed")
  if (first.kind !== "ok" || !("delivery_id" in first)) throw new Error("first send refused")
  expect(repeat).toMatchObject({ kind: "ok", collapsed: true, deduplicated: true, delivery_id: first.delivery_id })
})
