import { describe, expect, test } from "bun:test"
import type { CommandResult, DeviceService, RemoteAttach } from "@oh-my-opencode/device-service-core"
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
