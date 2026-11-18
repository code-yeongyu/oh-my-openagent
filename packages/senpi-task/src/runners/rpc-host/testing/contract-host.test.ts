import { describe, expect, test } from "bun:test"
import { once } from "node:events"
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
  return await withRpcSocket(
    host.socket,
    { timeoutMs: 2_000, secret: transport.secret, connect: () => createConnection(transport.address) },
    exercise,
  )
}

type Line = Record<string, unknown>

/** Every line the host writes on one connection for these requests, in order, until it answers the last of them. */
async function linesFor(host: ContractHost, requests: readonly Line[]): Promise<Line[]> {
  const transport = await resolveRpcSocketTransport(host.socket)
  if (transport === undefined) throw new Error(`no transport for ${host.socket}`)
  const socket = createConnection(transport.address)
  await once(socket, "connect")
  if (transport.secret !== undefined) socket.write(transport.secret)
  const lines: Line[] = []
  const answered = Promise.withResolvers<void>()
  let buffer = ""
  socket.setEncoding("utf8")
  socket.on("data", (chunk: string) => {
    buffer += chunk
    for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
      const line = JSON.parse(buffer.slice(0, newline)) as Line
      buffer = buffer.slice(newline + 1)
      lines.push(line)
      if (line["id"] === `r${requests.length}`) answered.resolve()
    }
  })
  socket.once("close", () => answered.reject(new Error("the host closed before it answered the last request")))
  requests.forEach((request, index) => socket.write(`${JSON.stringify({ ...request, id: `r${index + 1}` })}\n`))
  try {
    await answered.promise
  } finally {
    socket.destroy()
  }
  return lines
}

const ATTACH: Line = { type: "attach_session", sessionId: "rpc-1", durableSessionId: "dur-selected" }
const historyOf = (length: number): Line[] =>
  Array.from({ length }, (_, index) => ({ type: "message", id: `e${index + 1}` }))
const answerTo = (lines: readonly Line[], id: string): Line => {
  const answer = lines.find((line) => line["id"] === id)
  if (answer === undefined) throw new Error(`no answer to ${id}`)
  return answer
}

const hosts: readonly [string, ContractHostOptions][] = [
  ["an attach-capable host", {}],
  ["an older host without attachment", { legacy: true }],
]

describe("contract fake parity with the real multi-session host", () => {
  test.each(hosts)(
    "#given %s #when a wake names no session #then it is refused missing_session_id and nothing is mutated",
    async (_name, options) => {
      await withContractHost(options, async (host) => {
        const reply = await onConnection(host, (request) => request({ type: "wake", delivery_ids: [] }))
        expect(reply).toMatchObject({ success: false, error: "missing_session_id" })
        expect(host.mutations).toEqual([])
      })
    },
  )

  test("#given a multi-session host #when a session read names no session #then it is refused missing_session_id too", async () => {
    await withContractHost({}, async (host) => {
      expect(await onConnection(host, (request) => request({ type: "get_messages" }))).toMatchObject({
        success: false,
        error: "missing_session_id",
      })
    })
  })

  const refusals: readonly [string, ContractHostOptions, Record<string, unknown>][] = [
    [
      "unknown_session",
      { attachRefusal: "unknown_session" },
      { type: "attach_session", sessionId: "rpc-1", durableSessionId: "dur-selected" },
    ],
    ["session_identity_mismatch", {}, { type: "attach_session", sessionId: "rpc-1", durableSessionId: "dur-recycled" }],
    [
      "session_identity_mismatch",
      {},
      { type: "reclaim_session", sessionPath: "/session.jsonl", durableSessionId: "dur-recycled" },
    ],
  ]
  test.each(refusals)(
    "#given a refused attach #when the host answers %s #then the refusal carries errorData {} as the real host's does",
    async (code, options, command) => {
      await withContractHost(options, async (host) => {
        const reply = await onConnection(host, (request) => request(command))
        expect(reply).toMatchObject({ success: false, error: code })
        expect(reply.errorData).toEqual({})
      })
    },
  )

  test("#given an unattached connection #when it reads get_available_thinking_levels #then the host's exempt read answers instead of session_not_attached", async () => {
    await withContractHost({}, async (host) => {
      const reply = await onConnection(host, (request) =>
        request({ type: "get_available_thinking_levels", sessionId: "rpc-1" }),
      )
      expect(reply).toMatchObject({ success: true, data: { levels: expect.any(Array) } })
      expect(host.frames.some(({ frame }) => frame.type === "attach_session")).toBe(false)
    })
  })

  test("#given an unattached connection #when it sends a session mutation #then the gate still refuses it session_not_attached", async () => {
    await withContractHost({}, async (host) => {
      expect(
        await onConnection(host, (request) => request({ type: "set_session_name", sessionId: "rpc-1", name: "x" })),
      ).toMatchObject({ success: false, error: "session_not_attached" })
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
      expect(admitted).toMatchObject({
        success: false,
        error: "session_busy_lifecycle",
        errorData: { reason: "host_draining" },
      })
      const framesBefore = host.frames.length
      const arriving = await onConnection(host, (request) =>
        request({ type: "get_protocol_info", observe: true }),
      ).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect((arriving as Error).message).toMatch(/connection closed|ECONNRESET|EPIPE/)
      expect(host.frames.length).toBe(framesBefore)
    })
  })

  // senpi modes/rpc/get-snapshot.js: the newest `tail` entries (100 by default), history_truncated when older ones
  // remain and next_before naming the oldest one sent; connection-handler.js writes the marker on every routed connection.
  test("#given a history longer than the snapshot's tail #when a routed connection takes get_snapshot #then it pages as the engine does and the marker precedes the answer", async () => {
    await withContractHost({ history: historyOf(120) }, async (host) => {
      const lines = await linesFor(host, [
        ATTACH,
        { type: "get_snapshot", sessionId: "rpc-1" },
        { type: "get_snapshot", sessionId: "rpc-1", tail: 5 },
        { type: "get_snapshot", sessionId: "rpc-1", tail: 500 },
        { type: "get_snapshot", sessionId: "rpc-1", tail: -1 },
      ])
      const page = (id: string) => {
        const data = answerTo(lines, id)["data"] as Line
        const entries = data["entries"] as Line[]
        return [entries.length, entries[0]?.["id"], data["history_truncated"], data["next_before"]]
      }
      expect(page("r2")).toEqual([100, "e21", true, "e21"])
      expect(page("r3")).toEqual([5, "e116", true, "e116"])
      expect(page("r4")).toEqual([120, "e1", false, null])
      expect(answerTo(lines, "r5")).toMatchObject({ success: false, errorCode: "invalid_argument" })
      for (const id of ["r2", "r3", "r4"]) {
        const answer = answerTo(lines, id)
        const markerId = (answer["data"] as Line)["markerId"]
        expect(lines[lines.indexOf(answer) - 1]).toEqual({ type: "snapshot_marker", markerId, sessionId: "rpc-1" })
      }
    })
  })

  // senpi modes/rpc/get-entries-command.js: an unknown `before` is RPC_ERROR_ENTRY_NOT_FOUND ("not_found"), a page size
  // below one RPC_ERROR_INVALID_ARGUMENT.
  test("#given a history #when get_entries names an unknown before or a page below one #then the refusal carries the engine's errorCode", async () => {
    await withContractHost({ history: historyOf(3) }, async (host) => {
      const lines = await linesFor(host, [
        { type: "get_entries", sessionId: "rpc-1", before: "no-such-entry", tail: 2 },
        { type: "get_entries", sessionId: "rpc-1", tail: 0 },
      ])
      expect(answerTo(lines, "r1")).toMatchObject({
        success: false,
        error: "Entry not found: no-such-entry",
        errorCode: "not_found",
      })
      expect(answerTo(lines, "r2")).toMatchObject({ success: false, errorCode: "invalid_argument" })
    })
  })
})
