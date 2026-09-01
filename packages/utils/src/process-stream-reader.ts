import { Readable } from "node:stream"

export type ProcessReadableStream = ReadableStream<Uint8Array> | Readable | null | undefined

function bufferFromChunk(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk
  }

  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk)
  }

  if (typeof chunk === "string") {
    return Buffer.from(chunk, "utf8")
  }

  throw new TypeError(`Unsupported process stream chunk type: ${typeof chunk}`)
}

async function readWebStream(stream: ReadableStream<Uint8Array>): Promise<Buffer[]> {
  const reader = stream.getReader()
  const chunks: Buffer[] = []

  try {
    while (true) {
      const result = await reader.read()
      if (result.done) {
        return chunks
      }
      chunks.push(Buffer.from(result.value))
    }
  } finally {
    reader.releaseLock()
  }
}

async function readNodeStream(stream: Readable): Promise<Buffer[]> {
  const chunks: Buffer[] = []

  for await (const chunk of stream) {
    chunks.push(bufferFromChunk(chunk))
  }

  return chunks
}

function isWebReadableStream(stream: ProcessReadableStream): stream is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== "undefined" && stream instanceof ReadableStream
}

export async function readProcessStream(stream: ProcessReadableStream): Promise<string> {
  if (!stream) {
    return ""
  }

  // #3919: Buffer-concat avoids Response(stream).text() crashes in Windows utility processes.
  const chunks = isWebReadableStream(stream)
    ? await readWebStream(stream)
    : await readNodeStream(stream)

  return Buffer.concat(chunks).toString("utf8")
}
