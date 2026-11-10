import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "../thread-remote-fixture"
import type { RemoteSessionRow } from "./ports"

// Audit class C8 (#13017): a relay listing key that DIFFERS from the durable id. The id a caller sees in thread_list is the
// durable id, and that id addresses the row in every tool, while the transport still dispatches by the listing key.
const SPLIT: RemoteSessionRow = { device: "b", session_id: "rk-b-7", durable_id: "0195f0c2-1a2b-7c3d-8e4f-00000000007b", title: "split peer", project: "/w", path: "/b/s.jsonl", state: "idle", updated_ms: 1_700_000_000_000 }

describe("a listing key that differs from the durable id (decision 0027 D2)", () => {
  const fixture = createRemoteThreadFixture()
  afterEach(fixture.cleanup)

  test("#given b lists a thread whose listing key differs from its durable id #when thread_list is read and the listed id is sent to #then the id is the durable id and the send reaches b by the listing key", async () => {
    const a = fixture.account({ rows: [SPLIT], live: ["rk-b-7"] })
    const { run } = fixture.surface(a.remote)
    const listed = await run("thread_list", { all_scope: true })
    const row = listed.kind === "ok" && "threads" in listed ? (listed.threads as readonly { thread_id: string; device?: string }[]).find((t) => t.device === "b") : undefined
    expect(row?.thread_id).toBe(SPLIT.durable_id)
    expect(await run("thread_send", { thread: SPLIT.durable_id ?? "", message: "hi" })).toMatchObject({ kind: "ok", thread_id: SPLIT.durable_id, device: "b" })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message").map((entry) => [entry.device, entry.session])).toEqual([["b", "rk-b-7"]])
    expect(await run("thread_send", { thread: "rk-b-7", message: "by key" })).toMatchObject({ kind: "error", error: { code: "not_found" } })
  })
  test("#given the same row #when thread_create names its durable id #then it is that live thread on b (not not_found)", async () => {
    const a = fixture.account({ rows: [SPLIT], live: ["rk-b-7"] })
    const { run } = fixture.surface(a.remote)
    const result = await run("thread_create", { thread: SPLIT.durable_id ?? "" })
    // The row is live on b: opening it again is answered as that thread (already live there), never not_found.
    expect(JSON.stringify(result)).toContain(SPLIT.durable_id ?? "")
    expect(result.kind === "error" ? result.error.code : "ok").not.toBe("not_found")
  })
})
