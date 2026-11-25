import { afterEach, expect, test } from "bun:test"
import { B_FILE, B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"
import type { RemoteSessionsPort } from "./ports"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

function staleRoute(reason: string, keys: readonly string[]) {
  const key = "reopened-key"
  const a = account({
    live: [key],
    relayKeys: new Map([["dur-on-b", key]]),
    unlistedReason: "route_unlisted",
  })
  const lookups: (string | undefined)[] = []
  const sessions: RemoteSessionsPort = {
    ...a.remote.sessions,
    endpointKeys: async () => ({ keys }),
    endpointCommand: async (_device, rpc, options) => {
      expect(rpc).toEqual({ type: "find_session", durableSessionId: B_ROW.durable_id })
      lookups.push(options?.endpoint)
      return options?.endpoint !== undefined || reason === "disk-only"
        ? { kind: "ok", response: { data: { found: { open: options?.endpoint === "owner", sessionPath: B_FILE } } } }
        : { kind: "refused", reason }
    },
  }
  const { run } = surface({ ...a.remote, sessions })
  return {
    send: () => run("thread_send", { thread: B_ROW.durable_id, message: "still there?" }),
    lookups,
    admissions: () => a.sent.filter((e) => e.rpc?.["type"] === "admit_external_message").map((e) => e.session),
  }
}

test.each(["no_primary_endpoint", "route_unlisted", "disk-only"])(
  "a stale row reaches its live owner once when the primary lookup returns %s",
  async (reason) => {
    const w = staleRoute(reason, ["disk-only", "owner"])
    expect(await w.send()).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
    expect(w.lookups).toEqual([undefined, "disk-only", "owner"])
    expect(w.admissions()).toEqual(["reopened-key"])
  },
)

test("a missing primary and no listed engine do not admit a send", async () => {
  const w = staleRoute("no_primary_endpoint", [])
  expect(await w.send()).toMatchObject({ kind: "error" })
  expect(w.admissions()).toEqual([])
})

test("an authorization refusal does not redirect a lookup", async () => {
  const w = staleRoute("capability_missing", ["owner"])
  expect(await w.send()).toMatchObject({ kind: "error" })
  expect(w.lookups).toEqual([undefined])
  expect(w.admissions()).toEqual([])
})
