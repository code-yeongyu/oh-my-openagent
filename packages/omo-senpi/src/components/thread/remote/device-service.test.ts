import { describe, expect, test } from "bun:test"
import { LocalApiError, type CommandResult, type DeviceService, type RemoteAttach } from "@oh-my-opencode/device-service-core"
import { createDeviceServiceSessions } from "./device-service"
import { createLazyRemoteSurface } from "./lazy-remote"
import { openRemote } from "./remote-ops"

function fakeService(results: CommandResult[], sent: unknown[]): DeviceService {
  const attach = {
    command: async (rpc: unknown) => { sent.push(rpc); const next = results.shift(); if (next === undefined) throw new Error("no scripted result"); return next },
    read: async () => ({ entries: [{ entry_id: "e1", entry: { role: "user", content: "hi" } }, { entry_id: "e2", too_large: true, bytes: 9 }], next_before: null }),
    detached: new Promise(() => {}),
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
        return { command: async (rpc: Record<string, unknown>) => state({ state: "engine_applied" }, { type: "response", command: rpc["type"], success: true, data: { isStreaming: false, sessionId: ENGINE_ID } }), read: async () => ({ entries: [], next_before: null }), detached: new Promise(() => {}) } as unknown as RemoteAttach
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
          return { command: async () => { calls.sent += 1; return await commandAnswer() }, read: async () => ({ entries: [], next_before: null }), detached: new Promise<string>((resolve) => { detachAttach = () => resolve("detached") }) } as unknown as RemoteAttach
        },
        closed: new Promise<void>((resolve) => { closeService = resolve }),
      } as unknown as DeviceService
    }
    return { calls, connect: async () => service(), close: () => closeService(), detach: () => detachAttach(), answer: (next: () => Promise<CommandResult>) => { commandAnswer = next }, failAttach: (error: Error) => { attachFailure = error } }
  }

  test.each([
    ["the session is not on that device", new LocalApiError("session_not_found", "no such session"), "session_not_found"],
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
