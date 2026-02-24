import { HASHLINE_DICT } from "./constants"
import { createHashlineChunkFormatter } from "./hashline-chunk-formatter"

const RE_SIGNIFICANT = /[\p{L}\p{N}]/u

export function computeLineHash(lineNumber: number, content: string): string {
  const stripped = content.endsWith("\r") ? content.slice(0, -1).replace(/\s+/g, "") : content.replace(/\s+/g, "")
  const seed = RE_SIGNIFICANT.test(stripped) ? 0 : lineNumber
  const hash = Bun.hash.xxHash32(stripped, seed)
  const index = hash % 256
  return HASHLINE_DICT[index]
}

export function formatHashLine(lineNumber: number, content: string): string {
  const hash = computeLineHash(lineNumber, content)
  return `${lineNumber}#${hash}|${content}`
}

export function formatHashLines(content: string): string {
  if (!content) return ""
  const lines = content.split("\n")
  return lines.map((line, index) => formatHashLine(index + 1, line)).join("\n")
}

export interface HashlineStreamOptions {
  startLine?: number
  maxChunkLines?: number
  maxChunkBytes?: number
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    "getReader" in value &&
    typeof (value as { getReader?: unknown }).getReader === "function"
  )
}

async function* bytesFromReadableStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      if (value) yield value
    }
  } finally {
    reader.releaseLock()
  }
}

export async function* streamHashLinesFromUtf8(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  options: HashlineStreamOptions = {}
): AsyncGenerator<string> {
  const startLine = options.startLine ?? 1
  const maxChunkLines = options.maxChunkLines ?? 200
  const maxChunkBytes = options.maxChunkBytes ?? 64 * 1024
  const decoder = new TextDecoder("utf-8")
  const chunks = isReadableStream(source) ? bytesFromReadableStream(source) : source

  let lineNumber = startLine
  let pending = ""
  let sawAnyText = false
  let endedWithNewline = false
  const chunkFormatter = createHashlineChunkFormatter({ maxChunkLines, maxChunkBytes })

  const pushLine = (line: string): string[] => {
    const formatted = formatHashLine(lineNumber, line)
    lineNumber += 1
    return chunkFormatter.push(formatted)
  }

  const consumeText = (text: string): string[] => {
    if (text.length === 0) return []
    sawAnyText = true
    pending += text
    const chunksToYield: string[] = []

    while (true) {
      const idx = pending.indexOf("\n")
      if (idx === -1) break
      const line = pending.slice(0, idx)
      pending = pending.slice(idx + 1)
      endedWithNewline = true
      chunksToYield.push(...pushLine(line))
    }

    if (pending.length > 0) endedWithNewline = false
    return chunksToYield
  }

  for await (const chunk of chunks) {
    for (const out of consumeText(decoder.decode(chunk, { stream: true }))) {
      yield out
    }
  }

  for (const out of consumeText(decoder.decode())) {
    yield out
  }

  if (sawAnyText && (pending.length > 0 || endedWithNewline)) {
    for (const out of pushLine(pending)) {
      yield out
    }
  }

  const finalChunk = chunkFormatter.flush()
  if (finalChunk) yield finalChunk
}

export async function* streamHashLinesFromLines(
  lines: Iterable<string> | AsyncIterable<string>,
  options: HashlineStreamOptions = {}
): AsyncGenerator<string> {
  const startLine = options.startLine ?? 1
  const maxChunkLines = options.maxChunkLines ?? 200
  const maxChunkBytes = options.maxChunkBytes ?? 64 * 1024

  let lineNumber = startLine
  const chunkFormatter = createHashlineChunkFormatter({ maxChunkLines, maxChunkBytes })

  const pushLine = (line: string): string[] => {
    const formatted = formatHashLine(lineNumber, line)
    lineNumber += 1
    return chunkFormatter.push(formatted)
  }

  const asyncIterator = (lines as AsyncIterable<string>)[Symbol.asyncIterator]
  if (typeof asyncIterator === "function") {
    for await (const line of lines as AsyncIterable<string>) {
      for (const out of pushLine(line)) yield out
    }
  } else {
    for (const line of lines as Iterable<string>) {
      for (const out of pushLine(line)) yield out
    }
  }

  const finalChunk = chunkFormatter.flush()
  if (finalChunk) yield finalChunk
}
