import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "../thread-remote-fixture"

// #14394: b is online and its engine takes the open, but b's route never lists the session it made (the Desktop app's
// host). Nothing can address that thread: its name is not applied, its first prompt cannot be delivered, and no tool
// reaches it. The create must not answer ok with an orphan thread: it ends what it opened and refuses, typed.
const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

type Sent = ReturnType<typeof account>["sent"]
const endpointUnloads = (sent: Sent) =>
  sent.filter((entry) => entry.via === "endpoint" && entry.rpc?.["type"] === "unload_session")
const admissions = (sent: Sent) => sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message")

describe("thread_create on a device whose route does not reach the session it opened (#14394)", () => {
  test.each([
    ["a name and a first prompt", { name: "remote-lane", prompt: "go" }],
    ["a first prompt only", { prompt: "go" }],
  ] as const)(
    "#given b's engine takes the open but b's route never lists the new session #when thread_create runs on b with %s #then host_unavailable naming b, the session ended there, and no prompt sent",
    async (_case, args) => {
      const a = account({ openUnrouted: true, unlistedReason: "route_unlisted" })
      const { run } = surface(a.remote)
      expect(await run("thread_create", { device: "studio", ...args })).toMatchObject({
        kind: "error",
        error: { code: "host_unavailable", details: { device: "b", reason: "route_unlisted", created: false } },
      })
      expect(endpointUnloads(a.sent).map((entry) => entry.rpc?.["sessionId"])).toEqual(["rpc-9"])
      expect(admissions(a.sent)).toEqual([])
    },
  )

  test("#given the same device #when thread_create runs on b again under the same key #then the same refusal and still one open", async () => {
    const a = account({ openUnrouted: true, unlistedReason: "route_unlisted" })
    const { run } = surface(a.remote)
    const args = { device: "studio", prompt: "go", idempotency_key: "remote-create-1" }
    const first = await run("thread_create", args)
    expect(first).toMatchObject({ kind: "error", error: { code: "host_unavailable" } })
    expect(await run("thread_create", args)).toEqual(first)
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "open_session")).toHaveLength(1)
  })
})
