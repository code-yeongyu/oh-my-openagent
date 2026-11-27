import { StringDecoder } from "node:string_decoder"

import type { RpcObject } from "./socket-auth"

const isRecord = (value: unknown): value is RpcObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** One framed line as a record: a JSON object, or undefined for anything else (a host's stray output, a bad line). */
export function parseJsonObjectLine(line: string): RpcObject | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Strict LF framing of a JSONL byte stream (senpi docs/rpc.md "Framing"): only `\n` ends a record, a trailing `\r` is
 * dropped, blank lines are skipped, and a multi-byte character split across chunks is decoded whole. Each call takes
 * the next chunk and returns the lines it completed; an unterminated tail waits for the next chunk.
 */
export function createJsonlLines(): (chunk: string | Uint8Array) => string[] {
  const decoder = new StringDecoder("utf8")
  let pending = ""
  return (chunk) => {
    pending +=
      typeof chunk === "string" ? chunk : decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
    const lines: string[] = []
    for (let newline = pending.indexOf("\n"); newline >= 0; newline = pending.indexOf("\n")) {
      const raw = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw
      if (line.trim() !== "") lines.push(line)
    }
    return lines
  }
}
