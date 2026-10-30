import { describe, expect, test } from "bun:test"
import { createConnection } from "node:net"
import { resolveRpcSocketTransport, withRpcSocket, type RpcRequest } from "../socket-client"
import { withContractHost, type ContractHost, type ContractHostOptions } from "./contract-host"

/**
 * The contract fake must answer the way a real `senpi --mode rpc --multi-session` host does, or a client
 * bug the real host refuses passes against the fake (omo#10995 section 4, omo#11185).
 */

async function onConnection<T>(host: ContractHost, exercise: (request: RpcRequest) => Promise<T>): Promise<T> {
  const transport = await resolveRpcSocketTransport(host.socket)
  if (transport === undefined) throw new Error(`no transport for ${host.socket}`)
  return await withRpcSocket(host.socket, { timeoutMs: 2_000, secret: transport.secret, connect: () => createConnection(transport.address) }, exercise)
}

const hosts: readonly [string, ContractHostOptions][] = [["an attach-capable host", {}], ["an older host without attachment", { legacy: true }]]

describe("contract fake parity with the real multi-session host", () => {
  test.each(hosts)("#given %s #when a wake names no session #then it is refused missing_session_id and nothing is mutated", async (_name, options) => {
    await withContractHost(options, async (host) => {
      const reply = await onConnection(host, (request) => request({ type: "wake", delivery_ids: [] }))
      expect(reply).toMatchObject({ success: false, error: "missing_session_id" })
      expect(host.mutations).toEqual([])
    })
  })

  test("#given a multi-session host #when a session read names no session #then it is refused missing_session_id too", async () => {
    await withContractHost({}, async (host) => {
      expect(await onConnection(host, (request) => request({ type: "get_messages" }))).toMatchObject({ success: false, error: "missing_session_id" })
    })
  })

  const refusals: readonly [string, ContractHostOptions, Record<string, unknown>][] = [
    ["unknown_session", { attachRefusal: "unknown_session" }, { type: "attach_session", sessionId: "rpc-1", durableSessionId: "dur-selected" }],
    ["session_identity_mismatch", {}, { type: "attach_session", sessionId: "rpc-1", durableSessionId: "dur-recycled" }],
    ["session_identity_mismatch", {}, { type: "reclaim_session", sessionPath: "/session.jsonl", durableSessionId: "dur-recycled" }],
  ]
  test.each(refusals)("#given a refused attach #when the host answers %s #then the refusal carries errorData {} as the real host's does", async (code, options, command) => {
    await withContractHost(options, async (host) => {
      const reply = await onConnection(host, (request) => request(command))
      expect(reply).toMatchObject({ success: false, error: code })
      expect(reply.errorData).toEqual({})
    })
  })

  test("#given an unattached connection #when it reads get_available_thinking_levels #then the host's exempt read answers instead of session_not_attached", async () => {
    await withContractHost({}, async (host) => {
      const reply = await onConnection(host, (request) => request({ type: "get_available_thinking_levels", sessionId: "rpc-1" }))
      expect(reply).toMatchObject({ success: true, data: { levels: expect.any(Array) } })
      expect(host.frames.some(({ frame }) => frame.type === "attach_session")).toBe(false)
    })
  })

  test("#given an unattached connection #when it sends a session mutation #then the gate still refuses it session_not_attached", async () => {
    await withContractHost({}, async (host) => {
      expect(await onConnection(host, (request) => request({ type: "set_session_name", sessionId: "rpc-1", name: "x" }))).toMatchObject({ success: false, error: "session_not_attached" })
      expect(host.mutations).toEqual([])
    })
  })

  test("#given a host that starts draining #when a new client connects #then it is disconnected, while an admitted connection sees the host_draining attach refusal", async () => {
    await withContractHost({}, async (host) => {
      const admitted = await onConnection(host, async (request) => {
        expect(await request({ type: "get_protocol_info", observe: true })).toMatchObject({ success: true })
        host.drain()
        return await request({ type: "attach_session", sessionId: "rpc-1", durableSessionId: "dur-selected" })
      })
      expect(admitted).toMatchObject({ success: false, error: "session_busy_lifecycle", errorData: { reason: "host_draining" } })
      const framesBefore = host.frames.length
      const arriving = await onConnection(host, (request) => request({ type: "get_protocol_info", observe: true })).then(() => undefined, (error: unknown) => error)
      expect((arriving as Error).message).toMatch(/connection closed|ECONNRESET|EPIPE/)
      expect(host.frames.length).toBe(framesBefore)
    })
  })
})
