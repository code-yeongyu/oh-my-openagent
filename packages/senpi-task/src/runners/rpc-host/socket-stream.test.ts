import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createJsonlLines } from "./jsonl-lines"
import type { RpcObject } from "./socket-auth"
import { openRpcSocketStream, RpcStreamError, type Schedule } from "./socket-stream"
import { type ContractHost, withContractHost } from "./testing/contract-host"

// The long-lived host connection the omo SDK's raw session stream rides on (#15238): framing, auth, correlation by the
// stream's own ids, a per-request deadline on an injected clock, and one close.

const open = (host: ContractHost, extra: { onFrame?: (frame: RpcObject) => void; schedule?: Schedule } = {}) => {
  const closed = Promise.withResolvers<void>()
  let closes = 0
  return openRpcSocketStream(host.socket, {
    keyRoot: host.root,
    onFrame: extra.onFrame ?? (() => undefined),
    onClose: () => {
      closes += 1
      closed.resolve()
    },
    ...(extra.schedule === undefined ? {} : { schedule: extra.schedule }),
  }).then((stream) => ({ stream, closed: closed.promise, closes: () => closes }))
}

describe("createJsonlLines", () => {
  test("#given chunks that split a record, a CRLF ending, a blank line and a multi-byte character #when fed in order #then exactly the whole lines come out, decoded", () => {
    // given
    const lines = createJsonlLines()
    const bytes = new TextEncoder().encode('{"text":"한"}\r\n\n{"b":2}\n{"c"')
    const split = bytes.indexOf(0xed) + 1

    // when
    const first = lines(bytes.subarray(0, split))
    const second = lines(bytes.subarray(split))
    const third = lines(":3}\n")

    // then
    expect(first).toEqual([])
    expect(second).toEqual(['{"text":"한"}', '{"b":2}'])
    expect(third).toEqual(['{"c":3}'])
  })
})

describe("openRpcSocketStream", () => {
  test("#given a raw frame and a request on one connection #when the host answers both #then only the stream's own id settles the request and the other answer goes to onFrame", async () => {
    await withContractHost({}, async (host) => {
      // given
      const seen: RpcObject[] = []
      const { stream } = await open(host, { onFrame: (frame) => seen.push(frame) })

      // when
      stream.send({ type: "get_state", id: "client-1", sessionId: "rpc-1" })
      const reply = await stream.request({ type: "get_state", sessionId: "rpc-1" })

      // then
      expect(reply).toMatchObject({ type: "response", command: "get_state", success: true })
      expect(reply.id).not.toBe("client-1")
      expect(seen).toEqual([expect.objectContaining({ type: "response", id: "client-1" })])
      stream.close()
    })
  })

  test("#given a request the host never answers #when the injected clock reaches its deadline #then it is refused request_timeout", async () => {
    await withContractHost({ silent: ["get_state"] }, async (host) => {
      // given
      const timers: (() => void)[] = []
      const schedule: Schedule = (fire) => {
        timers.push(fire)
        return () => undefined
      }
      const { stream } = await open(host, { schedule })
      const pending = stream.request({ type: "get_state", sessionId: "rpc-1" })

      // when
      timers.at(-1)?.()

      // then
      const refusal = await pending.catch((error: unknown) => error)
      expect(refusal).toBeInstanceOf(RpcStreamError)
      expect(refusal).toMatchObject({ code: "request_timeout" })
      stream.close()
    })
  })

  test("#given a pending request #when the stream closes #then the request is refused closed and onClose runs once", async () => {
    await withContractHost({ silent: ["get_state"] }, async (host) => {
      // given
      const { stream, closed, closes } = await open(host)
      const pending = stream.request({ type: "get_state", sessionId: "rpc-1" }).catch((error: unknown) => error)

      // when
      stream.close()
      await closed

      // then
      expect(await pending).toMatchObject({ code: "closed" })
      expect(closes()).toBe(1)
      expect(() => stream.send({ type: "get_state" })).toThrow(RpcStreamError)
    })
  })

  test("#given an endpoint nothing listens on #when the stream opens #then it is refused not_running", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "rpc-stream-"))
    try {
      // when
      const refusal = await openRpcSocketStream(join(root, "rpc.sock"), {
        keyRoot: root,
        onFrame: () => undefined,
        onClose: () => undefined,
      }).catch((error: unknown) => error)

      // then
      expect(refusal).toBeInstanceOf(RpcStreamError)
      expect(refusal).toMatchObject({ code: "not_running" })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe.skipIf(process.platform === "win32")("openRpcSocketStream on a challenging POSIX host", () => {
  test("#given the host's key record #when the stream opens #then it authenticates before its first request", async () => {
    await withContractHost({ auth: true }, async (host) => {
      // when
      const { stream } = await open(host)
      const reply = await stream.request({ type: "get_state", sessionId: "rpc-1" })

      // then
      expect(reply.success).toBe(true)
      expect(host.frames.map(({ frame }) => frame.type)).toEqual(["get_protocol_info", "authenticate", "get_state"])
      stream.close()
    })
  })

  test("#given a wrong server proof #when the stream opens #then it is refused host_identity_unproven without a client proof", async () => {
    await withContractHost({ auth: true, badProof: true }, async (host) => {
      // when
      const refusal = await open(host).catch((error: unknown) => error)

      // then
      expect(refusal).toMatchObject({ code: "host_identity_unproven" })
      expect(host.frames.map(({ frame }) => frame.type)).toEqual(["get_protocol_info"])
    })
  })
})
