import { describe, expect, test } from "bun:test"
import { PassThrough, Readable, type Writable, Writable as WritableStream } from "node:stream"

import { isPlainRecord, jsonRpcId, type JsonRpcId } from "@oh-my-opencode/mcp-stdio-core"
import { runCodegraphMcpProxy } from "./proxy.js"
import type { CodegraphProjectSynchronizer, CodegraphServerHandle } from "./types.js"

type CapturedOutput = {
  readonly chunks: string[]
  readonly stream: Writable
}

type ProxyRun = {
  readonly input: Readable
  readonly output?: Writable
  readonly server: CodegraphServerHandle
  readonly synchronizer?: CodegraphProjectSynchronizer
}

const REFRESH_REJECTION_SCENARIOS = [
  { id: 7, label: "fails", message: "sync lock timed out", synchronizer: () => rejectionSynchronizer("throw") },
  { id: 27, label: "returns false", message: "CodeGraph project refresh did not complete", synchronizer: () => rejectionSynchronizer("false") },
] as const

describe("CodeGraph MCP proxy", () => {
  test("#given a framed client and newline-only child #when proxied #then child receives newline JSON and client receives a frame", async () => {
    const forwarded: string[] = []
    const output = captureOutput()
    const request = { jsonrpc: "2.0", id: 11, method: "tools/list" }

    const exitCode = await runProxy({
      input: Readable.from([framed(request)]),
      output: output.stream,
      server: fakeLineServer(forwarded),
    })

    expect(exitCode).toBe(0)
    expect(forwarded.join("")).toBe(`${JSON.stringify(request)}\n`)
    expect(output.chunks.join("")).toStartWith("Content-Length: ")
    expect(output.chunks.join("")).toContain('"id":11')
  })

  test("#given a line client and newline-only child #when proxied #then line framing is retained", async () => {
    const forwarded: string[] = []
    const output = captureOutput()
    const request = { jsonrpc: "2.0", id: 12, method: "tools/list" }

    await runProxy({
      input: Readable.from([line(request)]),
      output: output.stream,
      server: fakeLineServer(forwarded),
    })

    expect(forwarded.join("")).toBe(line(request))
    expect(output.chunks.join("")).toBe(line({ jsonrpc: "2.0", id: 12, result: { tools: [] } }))
  })

  test("#given mixed client framing #when child responses arrive out of order #then each response keeps its originating mode", async () => {
    const forwarded: string[] = []
    const output = captureOutput()
    const framedRequest = { jsonrpc: "2.0", id: "framed", method: "tools/list" }
    const lineRequest = { jsonrpc: "2.0", id: "line", method: "tools/list" }

    await runProxy({
      input: Readable.from([framed(framedRequest), line(lineRequest)]),
      output: output.stream,
      server: fakeLineServer(forwarded, "reverse-two"),
    })

    expect(forwarded.join("")).toBe(`${line(framedRequest)}${line(lineRequest)}`)
    expect(output.chunks.join("")).toContain(line({ jsonrpc: "2.0", id: "line", result: { tools: [] } }))
    expect(output.chunks.join("")).toContain(framed({ jsonrpc: "2.0", id: "framed", result: { tools: [] } }))
  })

  test("#given a secondary projectPath tool call #when proxied #then refresh finishes before forwarding", async () => {
    const events: string[] = []
    const forwarded: string[] = []
    const server = fakeServer(forwarded)
    const request = toolCall(1)
    server.input.on("data", () => events.push("forwarded"))

    const exitCode = await runProxy({
      input: Readable.from([line(request)]),
      server,
      synchronizer: {
        initialize: async () => {
          events.push("initial-ready")
        },
        refresh: async (projectPath, autoInit) => {
          events.push(`refreshed:${projectPath}`)
          expect(autoInit).toBe(true)
          return true
        },
      },
    })

    expect(exitCode).toBe(0)
    expect(events).toEqual(["initial-ready", "refreshed:/repo/b", "forwarded"])
    expect(forwarded.join("")).toContain('"projectPath":"/repo/b"')
  })

  for (const scenario of REFRESH_REJECTION_SCENARIOS) {
    for (const mode of ["line", "framed"] as const) {
      test(`#given secondary refresh ${scenario.label} for a ${mode} request #when proxied #then stale call is rejected and never forwarded`, async () => {
        const forwarded: string[] = [], output = captureOutput()
        const request = toolCall(scenario.id)

        await runProxy({
          input: Readable.from([mode === "line" ? line(request) : framed(request)]),
          output: output.stream,
          server: fakeServer(forwarded),
          synchronizer: scenario.synchronizer(),
        })

        const response = output.chunks.join("")
        expect(forwarded).toEqual([])
        if (mode === "line") {
          expect(response).toBe(line({ jsonrpc: "2.0", id: scenario.id, error: { code: -32001, message: scenario.message } }))
        } else {
          expect(response).toStartWith("Content-Length: ")
          expect(response).toContain(`"id":${scenario.id}`)
          expect(response).toContain('"code":-32001')
          expect(response).toContain(scenario.message)
        }
      })
    }
  }

  test("#given the child exits before client input completes #when proxied #then the proxy settles with the child exit code", async () => {
    const clientInput = new PassThrough()
    const baselineListeners = listenerCounts(clientInput)

    const exitCode = await runProxy({
      input: clientInput,
      server: earlyExitServer(42),
    })

    expect(exitCode).toBe(42)
    expect(clientInput.destroyed).toBe(false)
    expect(listenerCounts(clientInput)).toEqual(baselineListeners)

    clientInput.destroy()
  })

  test("#given child stdin applies backpressure #when proxied #then the proxy waits for drain and completes", async () => {
    const forwarded: string[] = []
    const request = { jsonrpc: "2.0", id: 21, method: "tools/list" }

    const exitCode = await runProxy({
      input: Readable.from([line(request)]),
      server: backpressureServer(forwarded),
    })

    expect(exitCode).toBe(0)
    expect(forwarded.join("")).toBe(line(request))
  })
})

function runProxy(options: ProxyRun): Promise<number> {
  return runCodegraphMcpProxy({
    autoInit: true,
    command: { argsPrefix: [], command: "/bin/codegraph" },
    cwd: "/repo/a",
    env: {},
    input: options.input,
    output: options.output ?? new PassThrough(),
    stderr: new PassThrough(),
    spawnServer: () => options.server,
    synchronizer: options.synchronizer ?? readySynchronizer(),
  })
}

function framed(payload: unknown): string {
  const body = JSON.stringify(payload)
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`
}

function line(payload: unknown): string {
  return `${JSON.stringify(payload)}\n`
}

function toolCall(id: number): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { arguments: { projectPath: "/repo/b", query: "fresh" }, name: "codegraph_search" },
  }
}

function captureOutput(): CapturedOutput {
  const chunks: string[] = []
  const stream = new PassThrough()
  stream.on("data", (chunk: Buffer | string) => chunks.push(String(chunk)))
  return { chunks, stream }
}

function listenerCounts(stream: Readable): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const eventName of stream.eventNames()) {
    const key = String(eventName)
    counts[key] = stream.listenerCount(eventName)
  }
  return counts
}

function readySynchronizer(): CodegraphProjectSynchronizer {
  return {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(true),
  }
}

function rejectionSynchronizer(result: "false" | "throw"): CodegraphProjectSynchronizer {
  return {
    initialize: () => Promise.resolve(),
    refresh: () => (result === "false" ? Promise.resolve(false) : Promise.reject(new Error("sync lock timed out"))),
  }
}

function fakeServer(forwarded: string[]): CodegraphServerHandle {
  const input = new PassThrough()
  const output = new PassThrough()
  input.on("data", (chunk: Buffer | string) => forwarded.push(String(chunk)))
  input.on("finish", () => output.end())
  return serverHandle(input, output, waitForFinish(input))
}

function fakeLineServer(forwarded: string[], mode: "same-order" | "reverse-two" = "same-order"): CodegraphServerHandle {
  const input = new PassThrough()
  const output = new PassThrough()
  const ids: JsonRpcId[] = []
  input.on("data", (chunk: Buffer | string) => {
    for (const lineChunk of String(chunk).split("\n")) {
      if (lineChunk.trim().length === 0) continue
      forwarded.push(`${lineChunk}\n`)
      if (!lineChunk.startsWith("{")) continue
      ids.push(rpcIdFromLine(lineChunk))
      if (mode === "same-order") output.write(line({ jsonrpc: "2.0", id: ids.at(-1) ?? null, result: { tools: [] } }))
      if (mode === "reverse-two" && ids.length === 2) {
        output.write(line({ jsonrpc: "2.0", id: ids[1] ?? null, result: { tools: [] } }))
        output.write(line({ jsonrpc: "2.0", id: ids[0] ?? null, result: { tools: [] } }))
      }
    }
  })
  input.on("finish", () => output.end())
  return serverHandle(input, output, waitForFinish(input))
}

function earlyExitServer(exitCode: number): CodegraphServerHandle {
  const input = new PassThrough()
  const output = new PassThrough()
  output.end()
  return serverHandle(input, output, Promise.resolve(exitCode))
}

function backpressureServer(forwarded: string[]): CodegraphServerHandle {
  const input = new BackpressureWritable(forwarded)
  const output = new PassThrough()
  input.on("finish", () => output.end())
  return serverHandle(input, output, waitForFinish(input))
}

function serverHandle(input: Writable, output: Readable, exit: Promise<number>): CodegraphServerHandle {
  return {
    input,
    output,
    error: new PassThrough(),
    wait: () => exit,
    terminate: () => input.destroy(),
  }
}

function waitForFinish(input: Writable): Promise<number> {
  return new Promise((resolve) => input.once("finish", () => resolve(0)))
}

function rpcIdFromLine(line: string): JsonRpcId {
  const parsed: unknown = JSON.parse(line)
  if (!isPlainRecord(parsed)) return null
  return jsonRpcId(parsed["id"])
}

class BackpressureWritable extends WritableStream {
  constructor(private readonly forwarded: string[]) {
    super({ highWaterMark: 1 })
  }

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.forwarded.push(String(chunk))
    queueMicrotask(callback)
  }
}
