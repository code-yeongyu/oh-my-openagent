import { ChildProcess } from "node:child_process"
import { PassThrough } from "node:stream"
import { describe, expect, test } from "bun:test"

import { createRpcChildHandle } from "./rpc/handle"
import { RpcProtocolClient } from "./rpc/protocol-client"
import { createHostSessionHandle } from "./rpc-host/handle"
import { FAKE_SESSION, fakeSessionPort } from "./rpc-host/handle.test-support"

function abortHarness(transport: "stdio" | "hosted") {
  const asked = Promise.withResolvers<Readonly<Record<string, unknown>>>()
  const released = Promise.withResolvers<undefined>()
  let queued = 2
  const answer = async (command: Readonly<Record<string, unknown>>) => {
    asked.resolve(command)
    await released.promise
    const cleared = command.clearQueue === true ? queued : 0
    queued -= cleared
    return { ...(typeof command.effectId === "string" ? { effectId: command.effectId } : {}), stopped: true, idle: true, cleared }
  }
  const child = new ChildProcess()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  Object.defineProperties(child, {
    stdin: { value: stdin }, stdout: { value: stdout }, stderr: { value: new PassThrough() },
  })
  stdin.on("data", (line: Buffer) => {
    const command = JSON.parse(line.toString())
    void answer(command).then(data => {
      stdout.write(`${JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data })}\n`)
    })
  })
  const port = fakeSessionPort()
  const handle = transport === "stdio"
    ? createRpcChildHandle({
      client: new RpcProtocolClient({ child }), child, taskId: "st_abort_receipt",
      heartbeatIntervalMs: 60_000, now: () => 1,
    })
    : createHostSessionHandle({
      client: { ...port, send: command => command.type === "abort" ? answer(command) : Promise.resolve() },
      session: FAKE_SESSION, taskId: "st_abort_receipt", heartbeatIntervalMs: 60_000,
      closeGraceMs: 100, now: () => 1, openDisposition: "attached",
    })
  return { handle, asked: asked.promise, release: () => released.resolve(undefined), queued: () => queued }
}

for (const transport of ["stdio", "hosted"] as const) {
  describe(`${transport} typed abort confirmation`, () => {
    test("waits for host quiescence and returns the queue-clear receipt", async () => {
      // given an idle session with two queued follow-ups and a held host response
      const harness = abortHarness(transport)
      let settled = false
      try {
        // when abort reaches the host, dispatch alone must not complete it
        const abort = harness.handle.abort().then(result => { settled = true; return result })
        const command = await harness.asked
        expect(settled).toBe(false)
        harness.release()
        const result = await abort

        // then both transports request and preserve the host's actual confirmation
        expect(command).toMatchObject({ type: "abort", awaitIdle: true, clearQueue: true })
        expect(command.effectId).toBeString()
        if (typeof command.effectId !== "string") throw new Error("abort effect identity missing")
        expect(result).toEqual({ effectId: command.effectId, stopped: true, idle: true, cleared: 2 })
        expect(harness.queued()).toBe(0)
      } finally {
        harness.release()
        await harness.handle.dispose()
      }
    })
  })
}
