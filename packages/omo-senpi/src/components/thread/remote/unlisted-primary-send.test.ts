import { afterEach, describe, expect, test } from "bun:test"
import { createThreadSdk } from "../sdk"
import { B_FILE, B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"
import type { JsonObject, RemoteCommandOutcome, RemoteSessionsPort } from "./ports"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

function scenario(
  api: "sdk" | "tool",
  primary: string,
  keys: readonly string[],
  writeOutcome?: RemoteCommandOutcome,
  liveListing = false,
) {
  const key = "reopened-key"
  const a = account({
    live: liveListing ? [B_ROW.session_id, key] : [key],
    relayKeys: new Map([["dur-on-b", key]]),
    unlistedReason: "route_unlisted",
    promptOutcome: writeOutcome,
    admitOutcome: writeOutcome,
  })
  const lookups: string[] = []
  const accepted: JsonObject[] = []
  const sessions: RemoteSessionsPort = {
    ...a.remote.sessions,
    endpointKeys: async () => ({ keys }),
    endpointCommand: async (_device, rpc, options) => {
      expect(rpc).toEqual({ type: "find_session", durableSessionId: B_ROW.durable_id })
      lookups.push(options?.endpoint ?? "primary")
      if (options?.endpoint === "denied") return { kind: "refused", reason: "capability_missing" }
      return options?.endpoint !== undefined || primary === "disk-only"
        ? { kind: "ok", response: { data: { found: { open: options?.endpoint === "owner", sessionPath: B_FILE } } } }
        : { kind: "refused", reason: primary }
    },
    sessionCommand: async (device, session, rpc) => {
      const outcome = await a.remote.sessions.sessionCommand(device, session, rpc)
      if (outcome.kind === "ok" && (rpc.type === "prompt" || rpc.type === "admit_external_message")) accepted.push(rpc)
      return outcome
    },
  }
  const remote = { ...a.remote, sessions }
  const { run, agentDir, store, host } = surface(remote)
  const sdk = createThreadSdk({ agentDir, store, host, remote, cwd: process.cwd(), user: "operator", uid: 501 })
  const request = { thread: "dur-on-b", idempotency_key: "one-send" }
  return {
    send: () =>
      api === "sdk"
        ? sdk.send({ ...request, text: "still there?" })
        : run("thread_send", { ...request, message: "still there?" }),
    lookups,
    accepted,
    writes: () => a.sent.filter((e) => e.rpc?.type === "prompt" || e.rpc?.type === "admit_external_message"),
    ownerWrites: () =>
      a.sent.filter((e) => e.session === key && ["prompt", "admit_external_message"].includes(String(e.rpc?.type))),
  }
}

for (const api of ["sdk", "tool"] as const)
  describe(`${api} send to a stale remote route`, () => {
    test.each(["no_primary_endpoint", "route_unlisted", "disk-only"])(
      "one accepted delivery after %s, even with a same-key replay",
      async (primary) => {
        const w = scenario(api, primary, ["disk-only", "owner"])
        for (let call = 0; call < 2; call++)
          expect(await w.send()).toMatchObject({ kind: "ok", thread: "dur-on-b", delivery: { kind: "started" } })
        expect(w.lookups).toStrictEqual(["primary", "disk-only", "owner"])
        expect(w.accepted).toEqual([
          expect.objectContaining(
            api === "sdk"
              ? { type: "prompt", sessionId: "reopened-key", message: "still there?" }
              : {
                  type: "admit_external_message",
                  sessionId: "reopened-key",
                  sender: { kind: "agent", session_id: "dur-caller" },
                },
          ),
        ])
      },
    )

    test("no listed owner prevents delivery", async () => {
      const w = scenario(api, "no_primary_endpoint", [])
      expect(await w.send()).toMatchObject({ kind: "error" })
      expect(w.lookups).toStrictEqual(["primary"])
      expect(w.ownerWrites()).toEqual([])
    })

    test.each([undefined, "denied"])("discovery stops at an authorization refusal: %s", async (endpoint) => {
      const w = scenario(api, endpoint === undefined ? "capability_missing" : "route_unlisted", ["denied", "owner"])
      expect(await w.send()).toMatchObject({ kind: "error", error: { code: "scope_denied" } })
      expect(w.lookups).toStrictEqual(endpoint === undefined ? ["primary"] : ["primary", endpoint])
      expect(w.ownerWrites()).toEqual([])
    })

    for (const liveListing of [true, false])
      describe(liveListing ? "on the listed key" : "after recovery", () => {
        test.each([
          ["refused", "capability_missing", "scope_denied"],
          ["refused", "request_timeout", "host_unavailable"],
          ["uncertain", "delivered_unconfirmed", "delivered_unconfirmed"],
        ] as const)("a write ending %s/%s is never repeated", async (kind, reason, code) => {
          const w = scenario(api, "route_unlisted", ["owner"], { kind, reason }, liveListing)
          for (let call = 0; call < 2; call++) expect(await w.send()).toMatchObject({ kind: "error", error: { code } })
          expect(w.lookups).toStrictEqual(liveListing ? [] : ["primary", "owner"])
          expect(w.writes().map((write) => write.session)).toEqual(
            liveListing ? [B_ROW.session_id] : api === "sdk" ? [B_ROW.session_id, "reopened-key"] : ["reopened-key"],
          )
        })
      })
  })
