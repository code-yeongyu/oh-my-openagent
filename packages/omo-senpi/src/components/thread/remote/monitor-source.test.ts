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
  expect(
    registerRemoteMonitorTargets(
      {
        registerRpcRemoteSource: (source) => {
          sources.push(source)
        },
      },
      remote,
    ),
  ).toBe(true)
  const [source] = sources
  if (source === undefined || sources.length !== 1)
    throw new Error(`expected one registered source, saw ${sources.length}`)
  return source
}

describe("monitor rpc remote targets (#12719): omo's RpcRemoteSource", () => {
  test("#given the thread id thread_list names (b's durable id) #when the monitor opens <device>/<thread id> #then it watches b's session under its listing key and labels lines with the id given", async () => {
    const a = account()
    const { lines, handlers } = capture()
    const opened = await registered(a.remote).open({ device: "b", session: "dur-on-b" }, {}, handlers)
    opened.stop()
    expect(a.sent.filter((entry) => entry.via === "watch").map((entry) => [entry.device, entry.session])).toEqual([
      ["b", "rk-on-b"],
    ])
    expect(opened.initial.rows.map((row) => row.sessionId)).toEqual(["dur-on-b"])
    expect(lines).toEqual([])
  })

  test("#given a target armed raw (a restored monitor) #when its device is named and its thread part is a name #then the module resolves both and the watch is b's listing key, under the label given (#14305)", async () => {
    const a = account()
    for (const [device, session] of [
      ["studio", "dur-on-b"],
      ["b", "on b"],
    ] as const) {
      const opened = await registered(a.remote).open({ device, session }, {}, capture().handlers)
      opened.stop()
      expect(opened.initial.rows.map((row) => row.sessionId)).toEqual([session])
    }
    expect(a.sent.filter((entry) => entry.via === "watch").map((entry) => [entry.device, entry.session])).toEqual([
      ["b", "rk-on-b"],
      ["b", "rk-on-b"],
    ])
  })

  test.each([
    ["offline", { online: false }],
    ["missing from this listing round", { incomplete: ["b"] }],
  ] as const)(
    "#given a persistent monitor restored on <device id>/<thread id> while b is %s #when it re-opens #then it watches b's listing key, leaving reachability to the watch, never a lost monitor",
    async (_case, options) => {
      const a = account(options)
      const opened = await registered(a.remote).open({ device: "b", session: "dur-on-b" }, {}, capture().handlers)
      opened.stop()
      expect(a.sent.filter((entry) => entry.via === "watch").map((entry) => [entry.device, entry.session])).toEqual([
        ["b", "rk-on-b"],
      ])
    },
  )

  test("#given a persistent monitor stored with b's NAME (studio/dur-on-b) restored while b is offline #when it re-opens #then it watches b's id and listing key, not the raw name", async () => {
    const a = account({ online: false })
    const opened = await registered(a.remote).open({ device: "studio", session: "dur-on-b" }, {}, capture().handlers)
    opened.stop()
    expect(a.sent.filter((entry) => entry.via === "watch").map((entry) => [entry.device, entry.session])).toEqual([
      ["b", "rk-on-b"],
    ])
  })

  test("#given a persistent monitor stored by thread NAME (b/on b) restored while b is offline #when it re-opens #then it refuses device_offline: a name never reaches a device unlisted", async () => {
    const a = account({ online: false })
    await expect(registered(a.remote).open({ device: "b", session: "on b" }, {}, capture().handlers)).rejects.toThrow(
      /^device_offline:/,
    )
    expect(a.sent.filter((entry) => entry.via === "watch")).toEqual([])
  })

  test.each([
    ["by id, offline", "b", { online: false }],
    ["by name, offline", "studio", { online: false }],
    ["by id, missing from this listing round", "b", { incomplete: ["b"] }],
  ] as const)(
    "#given a persistent device-wide monitor restored on <device>/* (%s) #when it re-opens #then it keeps following b's listing rows, never lost on the device check",
    async (_case, device, options) => {
      const opened = await registered(account(options).remote).open({ device, session: "*" }, {}, capture().handlers)
      opened.stop()
      expect(opened.initial.rows.map((row) => row.sessionId)).toEqual(["rk-on-b"])
    },
  )

  test("#given a persistent monitor stored as <this device's id>/<thread id> before the tool hook armed targets #when it is restored #then it watches that session on this device, as before (review L1 of #14406)", async () => {
    const a = account()
    const opened = await registered(a.remote).open({ device: "here", session: "dur-local" }, {}, capture().handlers)
    opened.stop()
    expect(a.sent.filter((entry) => entry.via === "watch").map((entry) => [entry.device, entry.session])).toEqual([
      ["here", "dur-local"],
    ])
  })

  test("#given device b by its name #when the monitor opens <device name>/* #then it follows b's listing rows", async () => {
    const opened = await registered(account().remote).open({ device: "studio", session: "*" }, {}, capture().handlers)
    opened.stop()
    expect(opened.initial.rows.map((row) => row.sessionId)).toEqual(["rk-on-b"])
  })

  test("#given b's engine names its session by its routing id #when its records reach senpi #then each carries the target label, so senpi keys them with the rows it armed", async () => {
    const a = account()
    const { lines, handlers } = capture()
    const opened = await registered(a.remote).open({ device: "b", session: "dur-on-b" }, {}, handlers)
    for (const watch of [...a.watchers]) {
      watch.record({ type: "session_status", sessionId: "rpc-1", status: "running" })
      watch.record({ type: "agent_settled", sessionId: "rpc-1", turnId: "7" })
    }
    opened.stop()
    expect(lines).toEqual([
      { type: "session_status", sessionId: "dur-on-b", status: "running" },
      { type: "agent_settled", sessionId: "dur-on-b", turnId: "7" },
    ])
  })

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
        { type: "agent_start", sessionId: "dur-on-b" },
        {
          type: "session_status",
          sessionId: "dur-on-b",
          status: "running",
          lastChange: { cause: "agent_start", by: "agent" },
        },
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
    watch?.resynced?.({
      from: "running",
      state: { status: "idle", sessionId: "dur-on-b", durableSessionId: "dur-1" },
      settledTurns: ["7"],
      restarted: false,
    })
    a.endWatches("access:peer_revoked")
    await Promise.resolve()
    const resynced: RpcRemoteState = {
      rows: [{ sessionId: "dur-on-b", status: "idle", durableSessionId: "dur-1" }],
      settledTurns: [{ sessionId: "dur-on-b", turnId: "7" }],
    }
    expect(lines).toEqual([{ lost: "closed" }, { resynced }, { ended: "peer_revoked" }])
  })

  test("#given a restored persistent monitor whose turn was running #when that turn is no longer running #then the open reports it settled while the caller was down", async () => {
    const a = account()
    const opened = await registered(a.remote).open(
      { device: "b", session: "dur-on-b" },
      { resumeFrom: "7" },
      capture().handlers,
    )
    opened.stop()
    expect(opened.initial.settledTurns).toEqual([{ sessionId: "dur-on-b", turnId: "7" }])
  })

  test("#given the account's plan has no relay #when a remote target is armed #then the open refuses it, typed", async () => {
    const a = account({ plan: "plan_required" })
    await expect(
      registered(a.remote).open({ device: "b", session: "dur-on-b" }, {}, capture().handlers),
    ).rejects.toThrow("relay_requires_paid_plan")
  })
})
