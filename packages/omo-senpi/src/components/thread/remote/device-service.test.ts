import { describe, expect, test } from "bun:test"
import { connectDeviceService, LocalApiError, type CommandResult, type DeviceService, type RemoteAttach } from "@oh-my-opencode/device-service-core"
import { withContractHost } from "../../../../../senpi-task/src/runners/rpc-host/testing/contract-host"
import type { ThreadReadInput } from "../contracts"
import { createLiveThreadSurface } from "../live-surface"
import { createDeviceServiceSessions } from "./device-service"
import { createLazyRemoteSurface } from "./lazy-remote"
import type { JsonObject, RemoteSessionRow, RemoteThreadSurface } from "./ports"
import { setModelRemote } from "./remote-controls"
import { closeRemote, interruptRemote, openRemote, promptRemote, readRemote } from "./remote-ops"

// An attach whose session stream stays silent: no record, frame or channel loss ever arrives.
const quietStream = { onEvent: () => () => {}, onFrame: () => () => {}, onChannelLoss: () => () => {} }

function fakeService(results: CommandResult[], sent: unknown[]): DeviceService {
  const attach = {
    command: async (rpc: unknown) => { sent.push(rpc); const next = results.shift(); if (next === undefined) throw new Error("no scripted result"); return next },
    read: async () => ({ entries: [{ entry_id: "e1", entry: { role: "user", content: "hi" } }, { entry_id: "e2", too_large: true, bytes: 9 }], next_before: null }),
    detached: new Promise(() => {}),
    ...quietStream,
  } as unknown as RemoteAttach
  return {
    status: async () => ({ state: "connected" }),
    thisDevice: async () => ({ id: "here", name: "this mac" }),
    devices: async () => [{ device: "b", label: "studio", kind: "desktop", platform: "darwin", last_seen_ms: 1, online: true }],
    sessions: async () => ({ rows: [{ device: "b", session_id: "s1", title: "t", project: "/p", path: "/p/s1.jsonl", state: "idle", updated_ms: 2, source: "live", as_of: 2 }] }),
    attach: async () => attach,
    closed: new Promise(() => {}),
  } as unknown as DeviceService
}

const state = (outcome: Record<string, unknown>, response?: Record<string, unknown>) => ({ outcome: { type: "event", kind: "session.command_state", command_id: "c", ...outcome }, ...(response === undefined ? {} : { response }) }) as unknown as CommandResult

describe("device-service adapter of the thread tools' account surface", () => {
  test("#given the device service #when the tools read the account and command b's session #then rows, devices and command outcomes map to the port, with undefined fields dropped from the record", async () => {
    const sent: unknown[] = []
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: async () => fakeService([state({ state: "engine_applied" }, { turnId: "t1" }), state({ state: "engine_refused", reason: "capability_missing", retryable: false }), state({ state: "uncertain", reason: "request_gone", retryable: false })], sent) })
    expect(await port.thisDevice()).toBe("here")
    expect(await port.devices()).toEqual([{ device: "b", label: "studio", online: true }])
    expect(await port.sessions()).toEqual([{ device: "b", session_id: "s1", title: "t", project: "/p", path: "/p/s1.jsonl", state: "idle", updated_ms: 2 }])
    expect(await port.sessionCommand("b", "s1", { type: "prompt", message: "x", streamingBehavior: undefined })).toEqual({ kind: "ok", response: { turnId: "t1" } })
    expect(sent).toEqual([{ type: "prompt", message: "x" }])
    expect(await port.sessionCommand("b", "s1", { type: "abort" })).toEqual({ kind: "refused", reason: "capability_missing" })
    expect(await port.sessionCommand("b", "s1", { type: "abort" })).toEqual({ kind: "uncertain", reason: "request_gone" })
    expect(await port.read("b", "s1", 10)).toEqual({ kind: "ok", response: { entries: [{ role: "user", content: "hi" }] } })
  })

  test("#given b's engine endpoint #when create/open/fork send a session-less record to b #then it goes through the device service's endpoint command and its outcome maps to the port", async () => {
    const sent: unknown[] = []
    const answers: Array<() => Promise<CommandResult>> = [
      async () => state({ state: "engine_applied" }, { type: "response", command: "open_session", success: true, data: { sessionId: "s-new" } }),
      async () => state({ state: "engine_refused", reason: "route_unlisted", retryable: false }),
      async () => { throw new LocalApiError("peer_not_found", "no such device") },
      async () => { throw new LocalApiError("request_timeout", "no answer", { command_id: "c" }) },
    ]
    const service = { ...fakeService([], []), endpointCommand: async (device: string, rpc: unknown) => { sent.push({ device, rpc }); const next = answers.shift(); if (next === undefined) throw new Error("no scripted answer"); return await next() } } as unknown as DeviceService
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: async () => service })
    expect(await port.endpointCommand("b", { type: "open_session", cwd: "/p", parent: undefined })).toEqual({ kind: "ok", response: { type: "response", command: "open_session", success: true, data: { sessionId: "s-new" } } })
    expect(sent).toEqual([{ device: "b", rpc: { type: "open_session", cwd: "/p" } }])
    expect(await port.endpointCommand("b", { type: "open_session" })).toEqual({ kind: "refused", reason: "route_unlisted" })
    expect(await port.endpointCommand("b", { type: "open_session" })).toEqual({ kind: "refused", reason: "peer_not_found" })
    expect(await port.endpointCommand("b", { type: "open_session" })).toEqual({ kind: "uncertain", reason: "reply_lost" })
  })

  test("#given b's engine applied a command but its reply says success false #when the outcome maps to the port #then it is refused with the reply's errorCode, else its error, else engine_failed, never ok", async () => {
    const failed = (extra: Record<string, unknown>) => state({ state: "engine_applied" }, { type: "response", command: "set_model", success: false, ...extra })
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: async () => ({ ...fakeService([failed({ error: "no such model", errorCode: "x" }), failed({ error: "no such model" }), failed({})], []), endpointCommand: async () => failed({ error: "bad cwd", errorCode: "cwd_missing" }) }) as unknown as DeviceService })
    expect(await port.sessionCommand("b", "s1", { type: "set_model", provider: "p", modelId: "m" })).toEqual({ kind: "refused", reason: "x" })
    expect(await port.sessionCommand("b", "s1", { type: "set_model", provider: "p", modelId: "m" })).toEqual({ kind: "refused", reason: "no such model" })
    expect(await port.sessionCommand("b", "s1", { type: "set_model", provider: "p", modelId: "m" })).toEqual({ kind: "refused", reason: "engine_failed" })
    expect(await port.endpointCommand("b", { type: "open_session", cwd: "/gone" })).toEqual({ kind: "refused", reason: "cwd_missing" })
  })

  test("#given the default surface #when the sidecar fails to load #then the call rejects, the failure is not cached, and the next call loads again", async () => {
    let loads = 0
    const surface = createLazyRemoteSurface({ version: "0.0.0-test", loadRuntime: async () => { loads += 1; if (loads === 1) throw new Error("sidecar missing"); return { createDeviceServiceSessions: () => createDeviceServiceSessions({ version: "0.0.0-test", connect: async () => fakeService([], []) }) } } })
    let first: unknown
    try { await surface.sessions.status() } catch (error) { first = error }
    expect(String(first)).toContain("sidecar missing")
    expect(await surface.sessions.status()).toEqual({ state: "connected" })
    expect(loads).toBe(2)
  })
})

describe("device-service adapter: a session created on another device is addressable right after create", () => {
  // The shapes a live relay run returned (2026-11-06): open_session answers the engine's session id (a UUID), while
  // the device's listing, and so session.attach, knows the session only by its stream key, which session.locate maps.
  const ENGINE_ID = "01a1b113-e083-7e39-a563-a85d700e9f66"
  const KEY = "r-hHna8ULeiwDYWgZggvPg"
  const opened = { type: "response", command: "open_session", success: true, data: { state: { sessionId: ENGINE_ID, cwd: "/home/u/.omo/hand", sessionFile: `/home/u/.omo/hand/agent/sessions/x/2026-11-06T13-37-13-110Z_${ENGINE_ID}.jsonl` }, sessionId: ENGINE_ID } }

  test("#given open_session answers the engine id and the listing lags the new key #when create then get_state run on that thread #then create names the listing key and the get_state succeeds", async () => {
    const attached: string[] = []
    let listed = false
    const service = {
      ...fakeService([], []),
      devices: async () => [{ device: "b", label: "studio", kind: "cli", platform: "linux", last_seen_ms: 1, online: true }],
      endpointCommand: async () => state({ state: "engine_applied" }, opened),
      locate: async (device: string, engineId: string) => {
        if (engineId !== ENGINE_ID) throw new LocalApiError("session_not_found", "no session with that engine id")
        return { device, key: KEY, session: `${device}.${KEY}` }
      },
      attach: async (device: string, sessionId: string) => {
        attached.push(sessionId)
        // The listing has the new key only after its next change: the first attach of the key is refused.
        if (sessionId !== KEY || !listed) { listed = sessionId === KEY; throw new LocalApiError("session_not_found", "no such session in that device's listing") }
        return { command: async (rpc: Record<string, unknown>) => state({ state: "engine_applied" }, { type: "response", command: rpc["type"], success: true, data: { isStreaming: false, sessionId: ENGINE_ID } }), read: async () => ({ entries: [], next_before: null }), detached: new Promise(() => {}), ...quietStream } as unknown as RemoteAttach
      },
    } as unknown as DeviceService
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: async () => service, retryDelay: async () => {} })
    const created = await openRemote({ sessions: port, chain: { stamp: (record) => record } }, { kind: "create", device: "b" })
    if (created.kind !== "ok" || !("thread" in created)) throw new Error(`create failed: ${JSON.stringify(created)}`)
    expect(created.thread.thread_id).toBe(KEY)
    const status = await port.sessionCommand("b", created.thread.thread_id, { type: "get_state", sessionId: created.thread.thread_id })
    expect(status.kind).toBe("ok")
    expect(attached.every((id) => id === KEY)).toBe(true)
  })

  test("#given the create reply carries the located session #when the session is created #then no session.locate is sent and the thread is that key", async () => {
    const located: string[] = []
    const service = {
      ...fakeService([], []),
      devices: async () => [{ device: "b", label: "studio", kind: "cli", platform: "linux", last_seen_ms: 1, online: true }],
      endpointCommand: async () => ({ ...state({ state: "engine_applied" }, opened), located: { key: KEY, session: `b.${KEY}` } }),
      locate: async (_device: string, engineId: string) => { located.push(engineId); throw new LocalApiError("session_not_found", "not expected") },
    } as unknown as DeviceService
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: async () => service, retryDelay: async () => {} })
    const created = await openRemote({ sessions: port, chain: { stamp: (record) => record } }, { kind: "create", device: "b" })
    if (created.kind !== "ok" || !("thread" in created)) throw new Error(`create failed: ${JSON.stringify(created)}`)
    expect(created.thread.thread_id).toBe(KEY)
    expect(located).toEqual([])
  })
})

describe("device-service adapter: relay round trips per thread op", () => {
  // The real device service SDK (connectDeviceService, openAttach, the delegated channel) over a scripted local API
  // connection: every frame that leaves this device toward the relay is counted, so each op's round trips are measured.
  const RELAY_FRAMES: ReadonlySet<string> = new Set(["session.attach", "session.command", "session.read", "session.locate", "session.endpoints", "sessions.list"])
  const row: RemoteSessionRow = { device: "b", session_id: "s1", title: "t", project: "/p", path: "/p/s1.jsonl", state: "idle", updated_ms: 2 }
  // What a create on b answers: the engine's own session id, and the key b's listing names the new session by.
  const CREATED_ENGINE_ID = "01a1b2c4-0000-7000-8000-000000000001"
  const CREATED_KEY = "Ab3dEfGh1jKlMnOpQrStUv"

  // `relayd`: how this device's service and b's host treat an open that asks for its located session (decision 0018
  // amendment 2026-11-06): `located` answers {key, session} on the reply, an `older-host` never adds it, and an
  // `older-local` service refuses the `locate` field as unknown before anything leaves this device.
  function relayWorld(relayd: "located" | "older-host" | "older-local" = "located") {
    const frames: string[] = []
    // Whether each endpoint command this device wrote asked for the located session.
    const locateAsked: boolean[] = []
    const listeners = new Set<(event: JsonObject) => void>()
    const emit = (event: JsonObject) => { for (const listener of [...listeners]) listener(event) }
    const models: Array<{ provider: string; id: string }> = [{ provider: "a", id: "m1" }, { provider: "a", id: "m2" }]
    const engine = { model: models[0], streaming: false }
    // Runs before the command's reply when set: an event of the session that lands while the command is in flight.
    let beforeReply: (() => void) | undefined
    // How the next set_model ends instead of applying, and how catalog reads end after it (a channel that lost one reply).
    let nextSet: { readonly state: "uncertain" | "engine_refused"; readonly reason: string; readonly catalogAfter?: string } | undefined
    let catalogRefused: string | undefined
    const data = (rpc: JsonObject): JsonObject => {
      switch (rpc["type"]) {
        case "get_state": return { isStreaming: engine.streaming, model: engine.model, pendingMessageCount: 0 }
        case "get_messages": return { messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 }] }
        case "get_available_models": return { models: models.map((model) => ({ ...model })) }
        case "set_model": engine.model = models.find((model) => model.id === rpc["modelId"]) ?? engine.model; return { ...engine.model }
        case "prompt": return { disposition: "started", turnId: "7" }
        case "interrupt": return { interrupted: false }
        case "unload_session": return { outcome: "unloaded" }
        default: return {}
      }
    }
    let close!: () => void
    const closed = new Promise<void>((resolve) => { close = resolve })
    const client = {
      welcome: { type: "welcome", v: 1, service_version: "1.4.0", owner: "service", server_proof: "p", server_nonce: "n", capabilities: [], state: { state: "connected" } },
      request: async (type: string) => {
        frames.push(type)
        if (type === "session.attach") return { attach: "a1" }
        if (type === "session.endpoints") return { endpoints: ["e1"] }
        if (type === "session.locate") return { device: "b", key: CREATED_KEY, session: `b.${CREATED_KEY}` }
        if (type === "status.get") return { state: "connected" }
        if (type === "devices.list") return { devices: [{ device: "b", label: "studio", kind: "cli", platform: "linux", last_seen_ms: 1, online: true }] }
        if (type === "session.detach") return {}
        throw new Error(`unexpected request ${type}`)
      },
      onEvent: (listener: (event: JsonObject) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
      command: async (_attach: string, rpc: JsonObject, commandId: string) => {
        frames.push("session.command")
        const scripted = rpc["type"] === "set_model" ? nextSet : rpc["type"] === "get_available_models" && catalogRefused !== undefined ? { state: "engine_refused" as const, reason: catalogRefused } : undefined
        if (rpc["type"] === "set_model") { nextSet = undefined; if (scripted !== undefined && "catalogAfter" in scripted) catalogRefused = scripted.catalogAfter }
        const known = rpc["type"] !== "set_model" || models.some((model) => model.provider === rpc["provider"] && model.id === rpc["modelId"])
        const response = known ? { type: "response", command: rpc["type"], success: true, data: data(rpc) } : { type: "response", command: "set_model", success: false, error: "Model not found" }
        const before = beforeReply
        beforeReply = undefined
        queueMicrotask(() => {
          before?.()
          if (scripted !== undefined) return emit({ type: "event", kind: "session.command_state", command_id: commandId, state: scripted.state, reason: scripted.reason, retryable: false })
          emit({ type: "event", kind: "session.command_event", device: "b", command_id: commandId, response })
          emit({ type: "event", kind: "session.command_state", command_id: commandId, state: "engine_applied", retryable: false })
        })
        return commandId
      },
      read: async () => { frames.push("session.read"); return { entries: [], next_before: null } },
      list: async () => { frames.push("sessions.list"); return { query_id: "q", revision: 1, rows: [], incomplete: [], devices: {} } },
      endpointCommand: async (_device: string, _endpoint: string, rpc: JsonObject, commandId: string, options?: { readonly locate?: boolean }) => {
        frames.push("session.command")
        const asked = options?.locate === true
        locateAsked.push(asked)
        if (asked && relayd === "older-local") throw new LocalApiError("invalid_request", "request has an unknown field")
        const response = { type: "response", command: rpc["type"], success: true, data: { state: { sessionId: CREATED_ENGINE_ID }, sessionId: CREATED_ENGINE_ID } }
        const located = asked && relayd === "located" ? { located: { key: CREATED_KEY, session: `b.${CREATED_KEY}` } } : {}
        queueMicrotask(() => {
          emit({ type: "event", kind: "session.command_event", device: "b", command_id: commandId, response, ...located })
          emit({ type: "event", kind: "session.command_state", command_id: commandId, state: "engine_applied", retryable: false })
        })
        return commandId
      },
      oversizedLines: () => 0,
      close: () => close(),
      closed,
    }
    // The host re-established the attach: a new snapshot replaces the session's state.
    const snapshot = () => emit({ type: "event", kind: "session.snapshot", attach: "a1", attach_id: 2, cursor: { marker_id: "m", last_entry_id: null }, state: {}, entries: [], history_truncated: false, oldest_entry_id: null })
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: () => connectDeviceService({ version: "0.0.0-test", stateDir: "/unused", connect: async () => client as never }) })
    const surface: RemoteThreadSurface = { sessions: port, chain: { stamp: (rpc) => rpc } }
    let seen = 0
    // The relay frames since the last call.
    const take = (): string[] => { const sent = frames.slice(seen).filter((frame) => RELAY_FRAMES.has(frame)); seen = frames.length; return sent }
    // The device's catalog changes after this device read it.
    const removeModel = (id: string) => { models.splice(models.findIndex((model) => model.id === id), 1) }
    const addModel = (model: { provider: string; id: string }) => { models.push(model) }
    return { port, surface, take, snapshot, removeModel, addModel, locateAsked, setEnds: (end: NonNullable<typeof nextSet>) => { nextSet = end }, inFlight: (event: () => void) => { beforeReply = event } }
  }

  test.each([
    ["a relayd that answers the open with its located session", "located", ["session.endpoints", "session.command", "session.attach"], [true]],
    ["an older host relayd that never adds the located session", "older-host", ["session.endpoints", "session.command", "session.locate", "session.attach"], [true]],
    ["an older local relayd that refuses the locate field", "older-local", ["session.endpoints", "session.command", "session.command", "session.locate", "session.attach"], [true, false]],
  ] as const)("#given %s #when a thread is created on b #then the open asks for its located session and session.locate runs only when the reply lacks it", async (_label, relayd, frames, asked) => {
    const w = relayWorld(relayd)
    const created = await openRemote(w.surface, { kind: "create", device: "b" })
    if (created.kind !== "ok" || !("thread" in created)) throw new Error(`create failed: ${JSON.stringify(created)}`)
    expect(created.thread.thread_id).toBe(CREATED_KEY)
    expect(w.take()).toEqual([...frames])
    expect(w.locateAsked).toEqual([...asked])
  })

  test("#given an existing row of b #when it is opened #then the open does not ask for a located session and nothing is located", async () => {
    const w = relayWorld()
    const opened = await openRemote(w.surface, { kind: "open", row })
    expect(opened.kind).toBe("ok")
    expect(w.take()).toEqual(["session.endpoints", "session.command"])
    expect(w.locateAsked).toEqual([false])
  })

  test("#given one remote session #when the thread ops run in turn #then the attach is opened once, status and the transcript are read from the device every time, an exact model in the held catalog is one set_model, and each command is one round trip", async () => {
    const w = relayWorld()
    const view = { thread: "s1" } as ThreadReadInput
    const steps: Array<[string, () => Promise<unknown>]> = [
      ["status (cold)", () => w.port.sessionCommand("b", "s1", { type: "get_state", sessionId: "s1" })],
      ["status", () => w.port.sessionCommand("b", "s1", { type: "get_state", sessionId: "s1" })],
      ["view (cold)", () => readRemote(w.surface, row, view)],
      ["view", () => readRemote(w.surface, row, view)],
      ["send", () => promptRemote(w.surface, row, { message: "x" }, 0)],
      ["status after send", () => w.port.sessionCommand("b", "s1", { type: "get_state", sessionId: "s1" })],
      ["model (cold catalog)", () => setModelRemote(w.surface, row, { model: "m2" })],
      ["model (exact provider/id)", () => setModelRemote(w.surface, row, { model: "a/m1" })],
      ["model (by id)", () => setModelRemote(w.surface, row, { model: "m2" })],
      ["interrupt", () => interruptRemote(w.surface, row, undefined)],
      ["close", () => closeRemote(w.surface, row)],
    ]
    const measured: Array<[string, string[]]> = []
    for (const [op, run] of steps) {
      await run()
      measured.push([op, w.take()])
    }
    expect(measured).toEqual([
      ["status (cold)", ["session.attach", "session.command"]],
      ["status", ["session.command"]],
      ["view (cold)", ["session.command"]],
      ["view", ["session.command"]],
      ["send", ["session.command"]],
      ["status after send", ["session.command"]],
      ["model (cold catalog)", ["session.command", "session.command"]],
      ["model (exact provider/id)", ["session.command"]],
      ["model (by id)", ["session.command", "session.command"]],
      ["interrupt", ["session.command"]],
      ["close", ["session.command"]],
    ])
  })

  test("#given a held catalog #when the host re-establishes the attach, or does so while the catalog is being read #then the next exact model switch reads the catalog again", async () => {
    const w = relayWorld()
    await setModelRemote(w.surface, row, { model: "m2" })
    w.snapshot()
    w.take()
    w.inFlight(w.snapshot)
    await setModelRemote(w.surface, row, { model: "a/m1" })
    expect(w.take()).toEqual(["session.command", "session.command"])
    await setModelRemote(w.surface, row, { model: "a/m2" })
    expect(w.take()).toEqual(["session.command", "session.command"])
    await setModelRemote(w.surface, row, { model: "a/m1" })
    expect(w.take()).toEqual(["session.command"])
  })

  test("#given a held catalog #when the exact set may have run (its reply lost) and the channel then refuses the catalog read #then the answer is idempotency_uncertain, as on dev, and nothing is re-read", async () => {
    const w = relayWorld()
    await setModelRemote(w.surface, row, { model: "m2" })
    w.take()
    w.setEnds({ state: "uncertain", reason: "request_gone", catalogAfter: "host_not_answering" })
    const result = await setModelRemote(w.surface, row, { model: "a/m1" })
    expect(result.kind === "error" ? result.error.code : result.kind).toBe("idempotency_uncertain")
    expect(w.take()).toEqual(["session.command"])
  })

  test("#given a held catalog whose exact model the device replaced #when the set is refused and a fresh catalog matches another model by a later rung #then that model is set, as a fresh catalog would", async () => {
    const w = relayWorld()
    await setModelRemote(w.surface, row, { model: "m2" })
    w.take()
    w.removeModel("m1")
    w.addModel({ provider: "x", id: "a/m1-v2" })
    const result = await setModelRemote(w.surface, row, { model: "a/m1" })
    expect(result.kind === "ok" && "model" in result ? result.model : result).toEqual({ provider: "x", id: "a/m1-v2" })
    expect(w.take()).toEqual(["session.command", "session.command", "session.command"])
  })

  test.each([
    ["a pattern the held catalog lacks", (_w: ReturnType<typeof relayWorld>) => {}, "zz", ["session.command"], "model_not_found"],
    ["an exact provider/id the device dropped since the catalog was held", (w: ReturnType<typeof relayWorld>) => w.removeModel("m1"), "a/m1", ["session.command", "session.command"], "model_not_found"],
  ] as const)("#given a held catalog and %s #when the model is set #then the answer is the one a fresh catalog gives", async (_label, change, model, frames, code) => {
    const w = relayWorld()
    await setModelRemote(w.surface, row, { model: "m2" })
    w.take()
    change(w)
    const result = await setModelRemote(w.surface, row, { model })
    expect(result.kind === "error" ? result.error.code : result.kind).toBe(code)
    expect(w.take()).toEqual([...frames])
  })
})

describe("device-service adapter: lost replies and connection lifecycle", () => {
  const lifecycle = () => {
    const calls = { connect: 0, attach: 0, sent: 0 }
    let closeService: () => void = () => {}
    let detachAttach: () => void = () => {}
    let commandAnswer: () => Promise<CommandResult> = async () => state({ state: "engine_applied" }, {})
    let attachFailure: Error | undefined
    const service = () => {
      calls.connect += 1
      return {
        status: async () => ({ state: "connected" }),
        attach: async () => {
          calls.attach += 1
          if (attachFailure !== undefined) throw attachFailure
          return { command: async () => { calls.sent += 1; return await commandAnswer() }, read: async () => ({ entries: [], next_before: null }), detached: new Promise<string>((resolve) => { detachAttach = () => resolve("detached") }), ...quietStream } as unknown as RemoteAttach
        },
        closed: new Promise<void>((resolve) => { closeService = resolve }),
      } as unknown as DeviceService
    }
    return { calls, connect: async () => service(), close: () => closeService(), detach: () => detachAttach(), answer: (next: () => Promise<CommandResult>) => { commandAnswer = next }, failAttach: (error: Error) => { attachFailure = error } }
  }

  test.each([
    ["the session is not on that device", new LocalApiError("session_not_found", "no such session"), "unknown_session"],
    ["the host does not answer the attach", new LocalApiError("host_not_answering", "no answer"), "host_not_answering"],
    ["the connection is lost before the attach", new Error("socket gone"), "attach_failed"],
  ] as const)("#given %s #when a command or a read is made #then each is refused typed with its code and no command is sent", async (_label, error, reason) => {
    const l = lifecycle()
    l.failAttach(error)
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: l.connect })
    expect(await port.sessionCommand("b", "s1", { type: "abort" })).toEqual({ kind: "refused", reason })
    expect(await port.read("b", "s1", 10)).toEqual({ kind: "refused", reason })
    expect(l.calls.sent).toBe(0)
  })

  test("#given a closed session #when the same prompt goes to this device's engine and to b #then both answer the same code (#12755)", async () => {
    let local: unknown
    await withContractHost({ auth: true, attachRefusal: "unknown_session" }, async (host) => {
      const client = createLiveThreadSurface(undefined, { env: { OMO_CODING_AGENT_DIR: host.root, SENPI_RPC_SOCKET: host.socket, SENPI_RPC_KEY_ROOT: host.root }, statusAll: async () => undefined, registry: async () => [] })
      local = await client.prompt("rpc-1", "hello", undefined, "dur-selected").then(() => "answered", (error: unknown) => (error as { code?: unknown }).code)
    })
    const l = lifecycle()
    l.failAttach(new LocalApiError("session_not_found", "no such session"))
    const remote = await createDeviceServiceSessions({ version: "0.0.0-test", connect: l.connect }).sessionCommand("b", "s1", { type: "prompt", message: "hello" })
    expect(local).toBe("unknown_session")
    expect(remote).toEqual({ kind: "refused", reason: String(local) })
  })

  test.each([
    ["the connection closes on a get_state probe", "get_state", () => Promise.reject(new LocalApiError("closed", "the connection closed")), "closed"],
    ["a get_messages read times out after sending", "get_messages", () => Promise.reject(new LocalApiError("request_timeout", "no reply", { command_id: "c1" })), "request_timeout"],
    ["the relay loses the evidence of a get_messages read", "get_messages", async () => state({ state: "uncertain", reason: "request_gone", retryable: false }), "request_gone"],
    ["the attach ends before a get_state probe's reply", "get_state", () => Promise.reject(new Error("the attach ended before the command settled: closed")), "reply_lost"],
  ] as const)("#given %s #when the read-only record fails #then it is refused with its code, never uncertain, since nothing can have run", async (_label, type, reply, reason) => {
    const l = lifecycle()
    l.answer(reply)
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: l.connect })
    expect(await port.sessionCommand("b", "s1", { type, sessionId: "s1" })).toEqual({ kind: "refused", reason })
  })

  test("#given a record that is not JSON #when it is commanded #then it is refused before any attach or send", async () => {
    const l = lifecycle()
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: l.connect })
    expect(await port.sessionCommand("b", "s1", { type: "prompt", message: Number.NaN })).toEqual({ kind: "refused", reason: "invalid_record" })
    expect(l.calls.attach).toBe(0)
    expect(l.calls.sent).toBe(0)
  })

  test.each([
    ["the attach ends before the reply", () => Promise.reject(new Error("the attach ended before its reply: closed"))],
    ["the local API times out after sending", () => Promise.reject(new LocalApiError("request_timeout", "no reply", { command_id: "c1" }))],
    // Client-raised codes with no command_id that the connection can fail a pending command with after sending it.
    ["the local connection closes after sending", () => Promise.reject(new LocalApiError("closed", "the connection closed"))],
    ["the service breaks the protocol after sending", () => Promise.reject(new LocalApiError("protocol_violation", "a response to no pending request"))],
    ["the service fails internally", () => Promise.reject(new LocalApiError("internal", "owner error"))],
  ] as const)("#given %s #when a command was sent #then the outcome is uncertain, never an error to retry, and it is sent once", async (_label, reply) => {
    const l = lifecycle()
    l.answer(reply)
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: l.connect })
    expect(await port.sessionCommand("b", "s1", { type: "prompt", message: "x" })).toEqual({ kind: "uncertain", reason: "reply_lost" })
    expect(l.calls.sent).toBe(1)
  })

  test.each(["not_attached", "command_id_conflict", "method_unclassified", "message_too_long"] as const)("#given the local API refuses a command with %s before running it #when it answers #then the outcome is refused with its code", async (code) => {
    const l = lifecycle()
    l.answer(() => Promise.reject(new LocalApiError(code, "refused before dispatch")))
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: l.connect })
    expect(await port.sessionCommand("b", "s1", { type: "abort" })).toEqual({ kind: "refused", reason: code })
  })

  test("#given the proven connection closes #when the next call runs #then a new connection is made", async () => {
    const l = lifecycle()
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: l.connect })
    await port.status()
    const closed = new Promise<void>((resolve) => queueMicrotask(resolve))
    l.close()
    await closed
    await Promise.resolve()
    await port.status()
    expect(l.calls.connect).toBe(2)
  })

  test("#given a session's attach ends #when the next command for that session runs #then a new attach is opened", async () => {
    const l = lifecycle()
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: l.connect })
    await port.sessionCommand("b", "s1", { type: "abort" })
    await port.sessionCommand("b", "s1", { type: "abort" })
    expect(l.calls.attach).toBe(1)
    l.detach()
    await Promise.resolve()
    await Promise.resolve()
    await port.sessionCommand("b", "s1", { type: "abort" })
    expect(l.calls.attach).toBe(2)
  })
})
