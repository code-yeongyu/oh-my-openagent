import { describe, expect, test } from "bun:test"
import { LocalApiError, type CommandResult, type DeviceService, type RemoteAttach } from "@oh-my-opencode/device-service-core"
import { createDeviceServiceSessions } from "./device-service"
import { createLazyRemoteSurface } from "./lazy-remote"

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

  test("#given the client without relay daemon #393's attach-less endpoint command #when a session-less record targets b #then it is refused typed and nothing is sent", async () => {
    const sent: unknown[] = []
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: async () => fakeService([], sent) })
    expect(await port.endpointCommand("b", { type: "open_session" })).toEqual({ kind: "refused", reason: "endpoint_command_unavailable" })
    expect(sent).toEqual([])
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
