import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "../thread-remote-fixture"
import type { RemoteSessionRow } from "./ports"

// Audit class C8 (#13017): a relay listing key that DIFFERS from the durable id. The id a caller sees in thread_list is the
// durable id, and that id addresses the row in every tool, while the transport still dispatches by the listing key.
const SPLIT: RemoteSessionRow = {
  device: "b",
  session_id: "rk-b-7",
  durable_id: "0195f0c2-1a2b-7c3d-8e4f-00000000007b",
  title: "split peer",
  project: "/w",
  path: "/b/s.jsonl",
  state: "idle",
  updated_ms: 1_700_000_000_000,
}

describe("a listing key that differs from the durable id (decision 0027 D2)", () => {
  const fixture = createRemoteThreadFixture()
  afterEach(fixture.cleanup)

  test("#given b lists a thread whose listing key differs from its durable id #when thread_list is read and the listed id is sent to #then the id is the durable id and the send reaches b by the listing key", async () => {
    const a = fixture.account({ rows: [SPLIT], live: ["rk-b-7"] })
    const { run } = fixture.surface(a.remote)
    const listed = await run("thread_list", { all_scope: true })
    const row =
      listed.kind === "ok" && "threads" in listed
        ? (listed.threads as readonly { thread_id: string; device?: string }[]).find((t) => t.device === "b")
        : undefined
    expect(row?.thread_id).toBe(SPLIT.durable_id)
    expect(await run("thread_send", { thread: SPLIT.durable_id ?? "", message: "hi" })).toMatchObject({
      kind: "ok",
      thread_id: SPLIT.durable_id,
      device: "b",
    })
    expect(
      a.sent
        .filter((entry) => entry.rpc?.["type"] === "admit_external_message")
        .map((entry) => [entry.device, entry.session]),
    ).toEqual([["b", "rk-b-7"]])
    expect(await run("thread_send", { thread: "rk-b-7", message: "by key" })).toMatchObject({
      kind: "error",
      error: { code: "not_found" },
    })
  })
  test("#given the same row #when thread_create names its durable id #then it is that live thread on b (not not_found)", async () => {
    const a = fixture.account({ rows: [SPLIT], live: ["rk-b-7"] })
    const { run } = fixture.surface(a.remote)
    const result = await run("thread_create", { thread: SPLIT.durable_id ?? "" })
    // The row is live on b: opening it again answers THAT thread as already live there (deduplicated), under its durable id.
    expect(result).toMatchObject({
      kind: "ok",
      deduplicated: true,
      thread: { thread_id: SPLIT.durable_id, device: "b" },
    })
  })
  test("#given b creates a thread whose engine reports a durable id different from the listing key #when thread_create runs on b #then the returned id is the durable id and a send to it resolves (round trip)", async () => {
    const DURABLE = "0195f0c2-1a2b-7c3d-8e4f-00000000009b"
    const a = fixture.account({
      rows: [SPLIT],
      live: ["rk-b-7"],
      openData: { sessionId: "rpc-9", state: { durableSessionId: DURABLE } },
      relayKeys: new Map([[DURABLE, "rk-b-9"]]),
    })
    const { run } = fixture.surface(a.remote)
    const created = await run("thread_create", { device: "b" })
    expect(created).toMatchObject({ kind: "ok", thread: { thread_id: DURABLE, device: "b" } })
    // Round trip: the id handed back is the one the resolver takes (the new row is listed under rk-b-9 with that durable id).
    const b = fixture.account({
      rows: [SPLIT, { ...SPLIT, session_id: "rk-b-9", durable_id: DURABLE, title: "new on b" }],
      live: ["rk-b-7", "rk-b-9"],
    })
    const again = fixture.surface(b.remote)
    expect(await again.run("thread_send", { thread: DURABLE, message: "hi" })).toMatchObject({
      kind: "ok",
      thread_id: DURABLE,
      device: "b",
    })
    expect(
      b.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message").map((entry) => entry.session),
    ).toEqual(["rk-b-9"])
  })
})
