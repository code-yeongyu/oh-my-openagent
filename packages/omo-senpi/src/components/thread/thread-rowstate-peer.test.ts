import { afterEach, expect, test } from "bun:test"
import type { RemoteSessionRow } from "./remote/ports"
import { B_ROW, createRemoteThreadFixture } from "./thread-remote-fixture"

const fixture = createRemoteThreadFixture()
afterEach(fixture.cleanup)

async function listPeers(rows: readonly RemoteSessionRow[]) {
  const b = fixture.account({ rows })
  const { run } = fixture.surface(b.remote)
  const list = await run("thread_list", { all_scope: true })
  if (!("threads" in list)) throw new Error("no rows")
  return (id: string) => list.threads.find((item) => item.thread === id)
}

const peer = (durable_id: string, liveness: unknown, source?: RemoteSessionRow["source"]): RemoteSessionRow => ({
  ...B_ROW,
  durable_id,
  session_id: `rk-${durable_id}`,
  liveness,
  ...(source === undefined ? {} : { source }),
})

test("reading a held peer reports the same whitelisted hold as its row", async () => {
  const hold = {
    kind: "session_hold",
    key: "interrupted-run",
    since: new Date(0).toISOString(),
    queue_depth: 3,
  } as const
  const b = fixture.account({ rows: [{ ...B_ROW, liveness: { kind: "held", hold: { ...hold, data: "private" } } }] })
  const { run } = fixture.surface(b.remote)
  const list = await run("thread_list", { all_scope: true })
  if (!("threads" in list)) throw new Error("no rows")
  const row = list.threads.find((item) => item.thread === B_ROW.durable_id)
  expect(row?.state).toBe("held")
  expect(row?.hold).toEqual(hold)
  const read = await run("thread_read", { thread: B_ROW.durable_id, all_scope: true })
  expect(read).toMatchObject({ kind: "ok", state: "held", hold })
  expect(JSON.stringify(read)).not.toContain('"data":"private"')
})

test("device A preserves B's per-host evidence without treating a legacy row as verified", async () => {
  const legacy = { ...B_ROW, durable_id: "legacy", session_id: "r0" }
  const fast = { ...B_ROW, durable_id: "fast", session_id: "r1", liveness: { kind: "running", activity: "running" } }
  const slow = {
    ...B_ROW,
    durable_id: "slow",
    session_id: "r2",
    liveness: { kind: "unknown", host: "engine-b2", reason: "host_not_answering" },
  }
  const b = fixture.account({ rows: [legacy, fast, slow] })
  const { run } = fixture.surface(b.remote)
  const result = await run("thread_list", { all_scope: true })
  if (!("threads" in result)) throw new Error("no rows")
  const row = (id: string) => result.threads.find((item) => item.thread === id)
  expect(row("legacy")).toMatchObject({ state: "idle", verification: "unverified" })
  expect(row("fast")).toMatchObject({ state: "running", liveness: fast.liveness })
  expect(row("slow")).toMatchObject({ state: "unknown", liveness: slow.liveness })
  expect(result.devices?.find((device) => device.device === "b")).toMatchObject({ host_counts: null })
})

// #15376 L2: an unknown host's id is the peer's own string, so only `[A-Za-z0-9_.:-]{1,128}` is forwarded.
test("a peer's unknown-host id outside the id charset or past 128 characters is not evidence: that row lists unverified", async () => {
  const unknownHost = (host: string) => ({ kind: "unknown", host, reason: "host_not_answering" })
  const refused = { slash: "engine/b2", space: "engine b2", non_ascii: "engine-\u00e92", over_128: "h".repeat(129) }
  const row = await listPeers([
    peer("at_128", unknownHost("h".repeat(128))),
    ...Object.entries(refused).map(([id, host]) => peer(id, unknownHost(host))),
  ])
  expect(row("at_128")).toMatchObject({ state: "unknown", liveness: unknownHost("h".repeat(128)) })
  for (const id of Object.keys(refused)) {
    expect(row(id)).toMatchObject({ thread: id, state: "idle", verification: "unverified" })
    expect(row(id)).not.toHaveProperty("liveness")
  }
})

// #15376 L3: a hold key is the peer's own string, so a key outside the known keys lists as "other".
test("a held peer's hold key outside the whitelist lists as other, never as sent", async () => {
  const hold = { kind: "session_hold", key: "a-private-reason", since: new Date(0).toISOString(), queue_depth: 2 }
  const row = await listPeers([peer("held", { kind: "held", hold })])
  const listed = { ...hold, key: "other" }
  expect(row("held")).toMatchObject({ state: "held", hold: listed, liveness: { kind: "held", hold: listed } })
  expect(JSON.stringify(row("held"))).not.toContain(hold.key)
})

// #15376 L4: a row the relay served from its cache is a snapshot, so even the liveness it carries is not evidence.
test("a cached peer row is a snapshot, not evidence: it lists unverified even when it carries liveness", async () => {
  const liveness = { kind: "running", activity: "running" }
  const row = await listPeers([peer("live", liveness), peer("cached", liveness, "cache")])
  expect(row("live")).toMatchObject({ state: "running", liveness })
  expect(row("cached")).toMatchObject({ verification: "unverified" })
  expect(row("cached")).not.toHaveProperty("liveness")
})
