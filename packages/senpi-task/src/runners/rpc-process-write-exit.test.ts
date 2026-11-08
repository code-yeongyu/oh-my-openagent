import type { ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { describe, expect, test } from "bun:test"

import { RpcProcessRunner } from "./rpc-process"
import { RpcProtocolClient } from "./rpc/protocol-client"

describe("RPC stdin write and child exit ordering (#11096)", () => {
  test("a live child past the exit bound retains the original write error", async () => {
    const stdin = new PassThrough()
    const child = Object.assign(new EventEmitter(), {
      stdin, stderr: new PassThrough(), stdout: new PassThrough(),
    }) as unknown as ChildProcess
    const error = Object.assign(new Error("synthetic closed pipe"), { code: "EPIPE" })
    Object.defineProperty(stdin, "write", {
      value: (_data: string, callback: (error: Error) => void): boolean => {
        callback(error)
        stdin.emit("error", error)
        return false
      },
    })
    const client = new RpcProtocolClient({ child })
    try {
      expect(await client.send({ type: "get_state" }).catch((caught: unknown) => caught)).toBe(error)
      expect(child.exitCode).toBeUndefined()
    } finally {
      client.detach()
    }
  })

  for (const delivery of ["callback", "event", "throw"]) {
    test(`an automatic UI answer's ${delivery} error waits for close`, async () => {
      const stdin = new PassThrough()
      const stdout = new PassThrough()
      const child = Object.assign(new EventEmitter(), {
        stdin, stdout, stderr: new PassThrough(),
      }) as unknown as ChildProcess
      const error = Object.assign(new Error("synthetic closed pipe"), { code: "EPIPE" })
      Object.defineProperty(stdin, "write", {
        value: (_data: string, callback?: (error: Error) => void): boolean => {
          queueMicrotask(() => child.emit("close", 1, null))
          if (delivery === "throw") throw error
          if (delivery === "event") stdin.emit("error", error)
          else callback?.(error)
          return false
        },
      })
      const client = new RpcProtocolClient({ child })
      const exited = new Promise<Error | undefined>((resolve) => client.onExit(resolve))
      try {
        stdout.write(`${JSON.stringify({ type: "extension_ui_request", id: "ui", method: "confirm" })}\n`)
        expect(client.exited).toBe(false)
        expect(await exited).toBeUndefined()
        expect(client.exited).toBe(true)
      } finally {
        client.detach()
      }
    })
  }

  for (const code of ["EPIPE", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END", "EOF"]) {
    for (const delivery of ["callback", "event", "throw"]) {
      for (const exited of [false, true]) {
        test(`${code} via ${delivery}, exit already emitted: ${exited}, retains the child's model failure`, async () => {
          const stdin = new PassThrough()
          const stderr = new PassThrough()
          const child = Object.assign(new EventEmitter(), {
            stdin, stderr, stdout: new PassThrough(), exitCode: null as number | null, signalCode: null,
          })
          const error = Object.assign(new Error("synthetic closed pipe"), { code })
          const close = (): void => {
            stderr.write('Error: Model "prov/ghost" not found. Use --list-models to see available models.\n')
            child.exitCode = 1
            if (!exited) child.emit("exit", 1, null)
            child.emit("close", 1, null)
          }
          Object.defineProperty(stdin, "write", {
            value: (_data: string, callback?: (error: Error) => void): boolean => {
              if (exited) {
                child.exitCode = 1
                child.emit("exit", 1, null)
              }
              setImmediate(close)
              if (delivery === "throw") throw error
              if (delivery === "event") stdin.emit("error", error)
              else callback?.(error)
              return false
            },
          })
          const runner = new RpcProcessRunner({
            modelAdmission: async () => {},
            spawnChild: () => child as unknown as ChildProcess,
            buildSpawn: (spec) => ({ command: "unused", args: [], cwd: spec.cwd, env: {} }),
          })

          const failure = await runner.start({
            task_id: "st_write_exit", cwd: process.cwd(), state_dir: process.cwd(),
            prompt: "hello", model: "prov/ghost",
          }).catch((caught: unknown) => caught)

          expect(failure).toMatchObject({
            failure: {
              kind: "model_unavailable", rejected_while: "exited",
              exit: { kind: "crashed", code: 1, signal: null },
            },
          })
        })
      }
    }
  }
})
