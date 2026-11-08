import { afterEach, describe, expect, test } from "bun:test"
import type { RpcRemoteHandlers, RpcRemoteSource, RpcRemoteState } from "../../../extension/types"
import { createRemoteThreadFixture, ENGINE } from "../thread-remote-fixture"
import { registerRemoteMonitorTargets } from "./lazy-ops"

const { account, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

function capture() {
  const lines: unknown[] = []
  const handlers: RpcRemoteHandlers = {
    record: (record) => lines.push(record),
    resynced: (state) => lines.push({ resynced: state }),
    lost: (reason) => lines.push({ lost: reason }),
    ended: (reason) => lines.push({ ended: reason }),
  }
  return { lines, handlers }
}

// The seam is registered through the engine's extension API only when it has one; the source it registers loads the
// thread client sidecar (in source, live-surface.ts) on its first open.
function registered(remote: ReturnType<typeof account>["remote"]): RpcRemoteSource {
  const sources: RpcRemoteSource[] = []
  expect(registerRemoteMonitorTargets({ registerRpcRemoteSource: (source) => { sources.push(source) } }, remote)).toBe(true)
  const [source] = sources
  if (source === undefined || sources.length !== 1) throw new Error(`expected one registered source, saw ${sources.length}`)
  return source
}

describe("monitor rpc remote targets (#12719): omo's RpcRemoteSource", () => {
  test("#given an engine without senpi's remote-target seam #when the thread component registers #then nothing is registered and nothing throws", () => {
    expect(registerRemoteMonitorTargets({}, account().remote)).toBe(false)
  })

  test("#given b's session through a relay that forwards no session_status #when the monitor follows it #then it starts from the session's state, and each lifecycle status change reaches senpi as a session_status record", async () => {
    const a = account({ engine: { ...ENGINE, streaming: false } })
    const { lines, handlers } = capture()
    const opened = await registered(a.remote).open({ device: "b", session: "dur-on-b" }, {}, handlers)
    const [watch] = [...a.watchers]
    if (watch === undefined) throw new Error("the source opened no watch")
    watch.record({ type: "agent_start" })
    watch.status?.({ from: "idle", to: "running", derived: true, cause: "agent_start" })
    watch.record({ type: "session_status", sessionId: "dur-on-b", status: "idle" })
    watch.status?.({ from: "running", to: "idle", derived: false })
    watch.status?.({ from: "idle", to: "running", derived: true, cause: "agent_start" })
    opened.stop()
    expect([opened.initial, lines]).toEqual([
      { rows: [{ sessionId: "dur-on-b", status: "idle" }], settledTurns: [], cursor: "" },
      [
        { type: "agent_start" },
        { type: "session_status", sessionId: "dur-on-b", status: "running", lastChange: { cause: "agent_start", by: "agent" } },
        { type: "session_status", sessionId: "dur-on-b", status: "idle" },
      ],
    ])
  })

  test("#given a gap #when the watch resyncs, loses the device and its access ends #then senpi gets the rows and turns settled meanwhile, one lost, and the access reason", async () => {
    const a = account()
    const { lines, handlers } = capture()
    await registered(a.remote).open({ device: "b", session: "dur-on-b" }, {}, handlers)
    const [watch] = [...a.watchers]
    watch?.lost?.("closed")
    watch?.resynced?.({ from: "running", state: { status: "idle", sessionId: "dur-on-b", durableSessionId: "dur-1" }, settledTurns: ["7"], restarted: false })
    a.endWatches("access:peer_revoked")
    await Promise.resolve()
    const resynced: RpcRemoteState = { rows: [{ sessionId: "dur-on-b", status: "idle", durableSessionId: "dur-1" }], settledTurns: [{ sessionId: "dur-on-b", turnId: "7" }] }
    expect(lines).toEqual([{ lost: "closed" }, { resynced }, { ended: "peer_revoked" }])
  })

  test("#given a restored persistent monitor whose turn was running #when that turn is no longer running #then the open reports it settled while the caller was down", async () => {
    const a = account()
    const opened = await registered(a.remote).open({ device: "b", session: "dur-on-b" }, { resumeFrom: "7" }, capture().handlers)
    opened.stop()
    expect(opened.initial.settledTurns).toEqual([{ sessionId: "dur-on-b", turnId: "7" }])
  })

  test("#given the account's plan has no relay #when a remote target is armed #then the open refuses it, typed", async () => {
    const a = account({ plan: "plan_required" })
    await expect(registered(a.remote).open({ device: "b", session: "dur-on-b" }, {}, capture().handlers)).rejects.toThrow("relay_requires_paid_plan")
  })
})
