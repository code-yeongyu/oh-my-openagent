import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DeviceService } from "../../device-service-core/src/index.ts"
import type { JsonObject, RemoteThreadSurface } from "../../omo-senpi/src/components/thread/remote/ports"
import { runSession } from "../remote-session-verbs"
import type { RemoteCommandDependencies } from "../remote-cli"

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    void promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

describe("#13269: a waiting send hands its message to the session before the follow attaches", () => {
  test("#given a watch attach slower than the delivery #when the send runs #then the prompt is handed over before the attach completes and the answer still streams once it does", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "omo-remote-send-13269-"))
    const previousDir = process.env.OMO_CODING_AGENT_DIR
    process.env.OMO_CODING_AGENT_DIR = agentDir
    const calls: string[] = []
    const written: string[] = []
    const promptSeen = Promise.withResolvers<void>()
    // The attach handshake modelled as a gate the test holds shut: over the relay it is slower than the delivery, so
    // the watch completes only once the prompt was handed over, and the reply lands only when the test releases it.
    const replyGate = Promise.withResolvers<void>()
    const replyGateDone = (): boolean => replyDone
    let replyDone = false
    let recordsOut = false
    const firstDelta = Promise.withResolvers<void>()
    let records: ((record: JsonObject) => void) | undefined
    const surface = {
      sessions: {
        status: async () => {
          calls.push("status")
          return { state: "connected" }
        },
        thisDevice: async () => "here",
        devices: async () => {
          calls.push("devices")
          return [{ device: "b", label: "b", online: true }]
        },
        read: async () => {
          calls.push("read")
          // The turn's records leave when the follower first comes looking, as the wire streams them after the
          // reply: the aim's probe read is that first look.
          if (!recordsOut && replyGateDone()) {
            recordsOut = true
            if (records !== undefined)
              for (const record of [
                { type: "agent_start" },
                { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hi there\n", contentIndex: 0 } },
                { type: "agent_settled" },
              ])
                records(record as JsonObject)
          }
          return { kind: "ok" as const, response: { entries: [] } }
        },
        watch: async (_device: string, _session: string, listener: (record: JsonObject) => void) => {
          calls.push("watch")
          records = listener
          await promptSeen.promise
          calls.push("watch-done")
          return { kind: "ok" as const, watch: { ended: new Promise<string>(() => {}), stop: () => {} } }
        },
        sessionCommand: async (_device: string, _session: string, rpc: JsonObject) => {
          calls.push(String(rpc["type"]))
          if (rpc["type"] !== "prompt")
            return {
              kind: "ok" as const,
              response: { type: "response", command: String(rpc["type"]), success: true, data: {} },
            }
          promptSeen.resolve()
          await replyGate.promise
          return {
            kind: "ok" as const,
            response: {
              type: "response",
              command: "prompt",
              success: true,
              data: { disposition: "started", turnId: "9" },
            },
          }
        },
      },
      chain: { stamp: (record: JsonObject) => record },
    } as unknown as RemoteThreadSurface
    const dependencies = {
      accountShow: async () => {
        throw new Error("not reached")
      },
      stateDir: "",
      connect: async () => {
        throw new Error("not reached")
      },
      now: () => 0,
      output: () => {},
      write: (text: string) => {
        written.push(text)
        firstDelta.resolve()
      },
      error: () => {},
      remote: () => surface,
    } as RemoteCommandDependencies
    try {
      const run = runSession(
        {} as DeviceService,
        {
          verb: "send",
          target: { device: "b", session: "s1" },
          text: "hello",
          delivery: "auto",
          wait: true,
        },
        false,
        dependencies,
      )
      // An early crash surfaces its cause instead of starving the circuit breaker.
      run.catch((error: unknown) => promptSeen.reject(error))
      await withTimeout(
        promptSeen.promise,
        8_000,
        "the message was never handed to the session: its delivery waits behind the follow's watch attach (#13269)",
      )
      // The reply lands and the follow aims (its attach may still be completing); the aim's probe read is the
      // turn's first hop out, so the answer streams from there and settles at its run's settle.
      replyDone = true
      replyGate.resolve()
      await withTimeout(firstDelta.promise, 8_000, "the turn's own deltas never printed after its reply")
      const exit = await withTimeout(run, 8_000, "the send never returned after its turn settled")
      expect(exit).toBe(0)
      expect(written).toEqual(["hi there\n"])
      expect(calls.indexOf("prompt")).toBeLessThan(calls.indexOf("watch-done"))
    } finally {
      if (previousDir === undefined) delete process.env.OMO_CODING_AGENT_DIR
      else process.env.OMO_CODING_AGENT_DIR = previousDir
      rmSync(agentDir, { recursive: true, force: true })
    }
  })
})
