import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type ContractHost,
  type ContractHostOptions,
  withContractHost,
} from "../../../../../senpi-task/src/runners/rpc-host/testing/contract-host"
import { attachRpcSession } from "./attach-rpc-session"
import type { RpcRecord, RpcSessionStream, RpcSessionTarget } from "./types"

// The SDK's raw pi-RPC stream to one session on a running shared host (#15238), against senpi-task's contract host over a
// real socket: the stream an integration relays to a single-session pi-RPC client.

const OPEN: RpcSessionTarget = { open: { cwd: "/work", kind: "interactive", permissionPreset: "auto" } }
const NEXT_RECORD_MS = 5_000

const withStream = (
  options: ContractHostOptions,
  target: RpcSessionTarget,
  exercise: (stream: RpcSessionStream, host: ContractHost) => Promise<void>,
) =>
  withContractHost(options, async (host) => {
    const attached = await attachRpcSession({ agentDir: host.root, socket: host.socket, session: target, env: {} })
    if (attached.kind === "error") throw new Error(`attach failed: ${attached.error.code} ${attached.error.message}`)
    await exercise(attached.stream, host)
  })

/** The next record, or done; a record that never comes fails the test by name instead of hanging it. */
const reader = (stream: RpcSessionStream) => {
  const iterator = stream.records[Symbol.asyncIterator]()
  return async (what: string): Promise<RpcRecord | "done"> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`waited ${NEXT_RECORD_MS} ms for ${what}`)), NEXT_RECORD_MS)
    })
    try {
      const step = await Promise.race([iterator.next(), late])
      return step.done === true ? "done" : step.value
    } finally {
      clearTimeout(timer)
    }
  }
}

const wireFrames = (host: ContractHost, type: string) =>
  host.frames.map(({ frame }) => frame).filter((frame) => frame.type === type)

describe("attachRpcSession", () => {
  test("#given records the host wrote before open_session answered, one of another session #when the session opens and a command is sent #then this session's records come first, untagged, then the command's reply", async () => {
    const beforeOpen = [{ type: "agent_start" }, { type: "agent_start", sessionId: "other-9" }]
    await withStream({ beforeOpen }, OPEN, async (stream, host) => {
      // given
      const next = reader(stream)
      expect(stream).toMatchObject({ sessionId: "rpc-1", durableSessionId: "dur-selected" })
      expect(wireFrames(host, "open_session")).toEqual([expect.objectContaining(OPEN.open)])

      // when
      const first = await next("the record written before the open answer")
      const sent = stream.send({ type: "get_state", id: "c-1" })
      const reply = await next("the get_state reply")
      host.push([{ type: "message_update", delta: "hi" }])
      const live = await next("a record written after the open")

      // then
      expect(first).toEqual({ type: "agent_start" })
      expect(sent).toBe(true)
      expect(wireFrames(host, "get_state")).toEqual([{ type: "get_state", id: "c-1", sessionId: "rpc-1" }])
      expect(reply).toMatchObject({ type: "response", id: "c-1", command: "get_state", success: true })
      expect(live).toEqual({ type: "message_update", delta: "hi" })
      await stream.detach()
    })
  })

  test("#given a host that names the durable id in its session_opened record, as a real host does #when the session opens #then the stream carries that id and the record still streams", async () => {
    const opened = { type: "session_opened", durableSessionId: "dur-opened", kind: "interactive" }
    await withStream({ beforeOpen: [opened] }, OPEN, async (stream) => {
      // given
      const next = reader(stream)

      // when
      const first = await next("the session_opened record")

      // then
      expect(stream.durableSessionId).toBe("dur-opened")
      expect(first).toEqual(opened)
      await stream.detach()
    })
  })

  test("#given raw JSONL bytes split across writes with a line that is not JSON #when written #then each whole record is sent and the bad line is answered back", async () => {
    await withStream({}, OPEN, async (stream) => {
      // given
      const next = reader(stream)

      // when
      const head = stream.write('{"type":"get_st')
      const tail = stream.write(new TextEncoder().encode('ate","id":"c-2"}\r\nnot json\n'))

      // then
      expect(head).toEqual({ sent: 0, rejected: [] })
      expect(tail).toEqual({ sent: 1, rejected: ["not json"] })
      expect(await next("the written command's reply")).toMatchObject({ id: "c-2", success: true })
      await stream.detach()
    })
  })

  test.each([
    ["by default it releases the attachment and the session stays", {}, "release_attachment", true],
    ["with close it closes the session", { close: true }, "close_session", false],
  ] as const)(
    "#given an open stream #when detached %s #then the stream ends detached",
    async (_name, options, command, live) => {
      await withStream({}, OPEN, async (stream, host) => {
        // given
        const next = reader(stream)

        // when
        const answer = await stream.detach(options)

        // then
        expect(answer).toEqual({ kind: "ok" })
        expect(wireFrames(host, command)).toEqual([expect.objectContaining({ type: command, sessionId: "rpc-1" })])
        expect(host.live()).toBe(live)
        expect(await stream.ended).toBe("detached")
        expect(await next("the end of the records")).toBe("done")
        expect(stream.send({ type: "get_state" })).toBe(false)
      })
    },
  )

  test("#given an open stream #when the host closes the session #then the stream ends session_closed", async () => {
    await withStream({}, OPEN, async (stream, host) => {
      // given
      const next = reader(stream)

      // when
      host.push([{ type: "session_closed" }])

      // then
      expect(await stream.ended).toBe("session_closed")
      expect(await next("the end of the records")).toBe("done")
    })
  })

  test("#given a session on the host #when attached by its durable id #then it attaches by the listed handle and streams its records", async () => {
    await withStream({}, { attach: { durableSessionId: "dur-selected" } }, async (stream, host) => {
      // given
      const next = reader(stream)

      // when
      host.push([{ type: "agent_end" }])

      // then
      expect(stream.sessionId).toBe("rpc-1")
      expect(wireFrames(host, "attach_session")).toEqual([
        expect.objectContaining({ sessionId: "rpc-1", durableSessionId: "dur-selected" }),
      ])
      expect(await next("the attached session's record")).toEqual({ type: "agent_end" })
      await stream.detach()
    })
  })

  test("#given a durable id the host does not list #when attached #then session_not_found, as data", async () => {
    await withContractHost({}, async (host) => {
      const attached = await attachRpcSession({
        agentDir: host.root,
        socket: host.socket,
        session: { attach: { durableSessionId: "dur-missing" } },
        env: {},
      })
      expect(attached).toMatchObject({ kind: "error", error: { code: "session_not_found" } })
    })
  })

  test("#given an endpoint nothing listens on #when attached #then not_running, as data", async () => {
    // A socket path no longer than the contract host's own: past the platform's socket path limit a dial is EINVAL.
    const root = mkdtempSync(join(tmpdir(), "rpc-sess-"))
    try {
      const attached = await attachRpcSession({
        agentDir: root,
        socket: join(root, "rpc.sock"),
        session: OPEN,
        env: {},
      })
      expect(attached).toMatchObject({ kind: "error", error: { code: "not_running" } })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe.skipIf(process.platform === "win32")("attachRpcSession on a challenging POSIX host", () => {
  test("#given the agent dir holding the host's key record #when attached #then it authenticates and opens", async () => {
    await withStream({ auth: true }, OPEN, async (stream, host) => {
      expect(host.frames.map(({ frame }) => frame.type).slice(0, 3)).toEqual([
        "get_protocol_info",
        "authenticate",
        "open_session",
      ])
      await stream.detach()
    })
  })

  test("#given a host whose proof does not verify #when attached #then host_identity_unproven, as data", async () => {
    await withContractHost({ auth: true, badProof: true }, async (host) => {
      const attached = await attachRpcSession({ agentDir: host.root, socket: host.socket, session: OPEN, env: {} })
      expect(attached).toMatchObject({ kind: "error", error: { code: "host_identity_unproven" } })
    })
  })
})
