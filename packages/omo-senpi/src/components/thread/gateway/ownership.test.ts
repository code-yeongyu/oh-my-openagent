import { afterEach, expect, test } from "bun:test"
import { publishedWorld } from "../published-endpoint-fixture"

const worlds: Array<Awaited<ReturnType<typeof publishedWorld>>> = []
afterEach(async () => { for (const w of worlds.splice(0)) await w.close() })
async function world() { const w = await publishedWorld(); worlds.push(w); return w }

test("successful host registration publishes ownership and release clears it", async () => {
  const w = await world()
  const owner = await w.owner("host")
  const live = await w.store.sessionOwner("target")
  if (live === null) throw new Error("registered owner was not published")
  expect(live?.endpoint).toEqual({ kind: "rpc_host", socket: owner.socketPath })
  expect(live?.incarnation).toBeString()
  await owner.stop()
  expect(await w.store.sessionOwner("target")).toEqual({ incarnation: live.incarnation, endpoint: null })
})

test("successful terminal registration publishes the terminal endpoint kind", async () => {
  const w = await world()
  const owner = await w.owner("terminal", w.dir, "target", true)
  expect((await w.store.sessionOwner("target"))?.endpoint).toEqual({ kind: "tui", socket: owner.socketPath })
})

test("late release leaves the new incarnation and endpoint intact", async () => {
  const w = await world()
  const a = await w.owner("a")
  const b = await w.owner("b")
  const takeover = await w.store.sessionOwner("target")
  await a.stop()
  expect(await w.store.sessionOwner("target")).toEqual(takeover)
  expect(takeover?.endpoint?.socket).toBe(b.socketPath)
})

test("publishing a new incarnation invalidates the earlier ownership token", async () => {
  const w = await world()
  const a = await w.owner("a")
  const old = await w.store.sessionOwner("target")
  await w.store.registerIncarnation({ durable_id: "target", incarnation: "new", endpoint: { kind: "rpc_host", socket: a.socketPath } })
  await a.stop()
  expect(await w.store.sessionOwner("target")).toEqual({ incarnation: "new", endpoint: { kind: "rpc_host", socket: a.socketPath } })
  expect(old?.incarnation).not.toBe("new")
})
