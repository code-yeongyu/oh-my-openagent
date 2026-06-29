import { PassThrough, type Readable, type Writable, Writable as WritableStream } from "node:stream"

import { isPlainRecord, jsonRpcId, type JsonRpcId } from "@oh-my-opencode/mcp-stdio-core"

import type { CodegraphServerHandle } from "./types.js"

export function fakeServer(forwarded: string[]): CodegraphServerHandle {
  const input = new PassThrough()
  const output = new PassThrough()
  input.on("data", (chunk: Buffer | string) => forwarded.push(String(chunk)))
  input.on("finish", () => output.end())
  return serverHandle(input, output, waitForFinish(input))
}

export function fakeLineServer(forwarded: string[], mode: "same-order" | "reverse-two" = "same-order"): CodegraphServerHandle {
  const input = new PassThrough()
  const output = new PassThrough()
  const ids: JsonRpcId[] = []
  input.on("data", (chunk: Buffer | string) => {
    for (const lineChunk of String(chunk).split("\n")) {
      if (lineChunk.trim().length === 0) continue
      forwarded.push(`${lineChunk}\n`)
      if (!lineChunk.startsWith("{")) continue
      ids.push(rpcIdFromLine(lineChunk))
      if (mode === "same-order") output.write(jsonLine({ jsonrpc: "2.0", id: ids.at(-1) ?? null, result: { tools: [] } }))
      if (mode === "reverse-two" && ids.length === 2) {
        output.write(jsonLine({ jsonrpc: "2.0", id: ids[1] ?? null, result: { tools: [] } }))
        output.write(jsonLine({ jsonrpc: "2.0", id: ids[0] ?? null, result: { tools: [] } }))
      }
    }
  })
  input.on("finish", () => output.end())
  return serverHandle(input, output, waitForFinish(input))
}

export function earlyExitServer(exitCode: number): CodegraphServerHandle {
  const input = new PassThrough()
  const output = new PassThrough()
  output.end()
  return serverHandle(input, output, Promise.resolve(exitCode))
}

export function backpressureServer(forwarded: string[]): CodegraphServerHandle {
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

function jsonLine(payload: unknown): string {
  return `${JSON.stringify(payload)}\n`
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
