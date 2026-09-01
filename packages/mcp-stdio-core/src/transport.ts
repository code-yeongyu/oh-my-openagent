import type { Readable, Writable } from "node:stream"

export type StdioJsonRpcResponseMode = "line" | "framed"

export type StdioJsonRpcMessage =
  | {
      readonly kind: "request"
      readonly payload: unknown
      readonly responseMode: StdioJsonRpcResponseMode
    }
  | {
      readonly kind: "parse_error"
      readonly message: string
      readonly responseMode: StdioJsonRpcResponseMode
    }

type ReadResult =
  | { readonly kind: "incomplete" }
  | {
      readonly kind: "complete"
      readonly message?: StdioJsonRpcMessage
      readonly remaining: Buffer<ArrayBufferLike>
    }

const HEADER_SEPARATOR = Buffer.from("\r\n\r\n")

export async function* readStdioJsonRpcMessages(input: Readable): AsyncGenerator<StdioJsonRpcMessage> {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)

  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, bufferFromChunk(chunk)])
    while (true) {
      const result = readNextMessage(buffer)
      if (result.kind === "incomplete") break
      buffer = result.remaining
      if (result.message) yield result.message
    }
  }

  const trailing = buffer.toString("utf8").trim()
  if (trailing.length > 0) {
    yield parseJsonPayload(trailing, "line")
  }
}

export async function writeStdioJsonRpcResponse(
  output: Writable,
  response: unknown,
  responseMode: StdioJsonRpcResponseMode,
): Promise<void> {
  const body = JSON.stringify(response)
  const payload =
    responseMode === "framed"
      ? `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`
      : `${body}\n`
  await writeChunk(output, payload)
}

function writeChunk(output: Writable, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const onError = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    output.once("error", onError)

    try {
      output.write(chunk, (error?: Error | null) => {
        if (settled) return
        settled = true
        if (error) {
          queueMicrotask(() => output.removeListener("error", onError))
          reject(error)
          return
        }
        output.removeListener("error", onError)
        resolve()
      })
    } catch (error) {
      output.removeListener("error", onError)
      if (settled) return
      settled = true
      reject(error)
    }
  })
}

function readNextMessage(buffer: Buffer<ArrayBufferLike>): ReadResult {
  if (buffer.length === 0) return { kind: "incomplete" }
  return startsWithContentLength(buffer) ? readFramedMessage(buffer) : readLineMessage(buffer)
}

function readLineMessage(buffer: Buffer<ArrayBufferLike>): ReadResult {
  const newlineIndex = buffer.indexOf(0x0a)
  if (newlineIndex === -1) return { kind: "incomplete" }
  const line = buffer.subarray(0, newlineIndex).toString("utf8").replace(/\r$/, "")
  if (line.trim().length === 0) {
    return { kind: "complete", remaining: buffer.subarray(newlineIndex + 1) }
  }
  return {
    kind: "complete",
    message: parseJsonPayload(line, "line"),
    remaining: buffer.subarray(newlineIndex + 1),
  }
}

function readFramedMessage(buffer: Buffer<ArrayBufferLike>): ReadResult {
  const separatorIndex = buffer.indexOf(HEADER_SEPARATOR)
  if (separatorIndex === -1) return { kind: "incomplete" }

  const headers = buffer.subarray(0, separatorIndex).toString("ascii")
  const contentLength = parseContentLength(headers)
  const bodyStart = separatorIndex + HEADER_SEPARATOR.length
  if (contentLength === undefined) {
    return {
      kind: "complete",
      message: {
        kind: "parse_error",
        message: "Missing or invalid Content-Length header",
        responseMode: "framed",
      },
      remaining: buffer.subarray(bodyStart),
    }
  }

  const bodyEnd = bodyStart + contentLength
  if (buffer.length < bodyEnd) return { kind: "incomplete" }
  const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8")
  return {
    kind: "complete",
    message: parseJsonPayload(body, "framed"),
    remaining: buffer.subarray(bodyEnd),
  }
}

function startsWithContentLength(buffer: Buffer<ArrayBufferLike>): boolean {
  const prefix = buffer.subarray(0, "content-length:".length).toString("ascii").toLowerCase()
  return prefix === "content-length:"
}

function parseContentLength(headers: string): number | undefined {
  for (const line of headers.split("\r\n")) {
    const match = /^content-length:\s*(\d+)$/i.exec(line)
    if (match === null) continue
    const value = match[1]
    if (value === undefined) return undefined
    return Number(value)
  }
  return undefined
}

function parseJsonPayload(payload: string, responseMode: StdioJsonRpcResponseMode): StdioJsonRpcMessage {
  try {
    return { kind: "request", payload: JSON.parse(payload), responseMode }
  } catch (error) {
    return { kind: "parse_error", message: error instanceof Error ? error.message : String(error), responseMode }
  }
}

function bufferFromChunk(chunk: unknown): Buffer<ArrayBufferLike> {
  if (Buffer.isBuffer(chunk)) return chunk
  if (typeof chunk === "string") return Buffer.from(chunk)
  throw new TypeError(`Unsupported stdio chunk type: ${typeof chunk}`)
}
