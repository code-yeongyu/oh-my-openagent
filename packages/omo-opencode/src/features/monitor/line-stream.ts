export interface DecodedLine {
  text: string
  rawText: string
  truncated?: boolean
  binary?: boolean
}

export type LineStreamResult = {
  lines: DecodedLine[]
  binarySuppressedBytes: number
}

const DEFAULT_BINARY_THRESHOLD = 0.3

const ANSI_PATTERN = new RegExp(
  [
    "\\x1b\\[[0-?]*[ -/]*[@-~]",
    "\\x1b\\][^\\x07]*(?:\\x07|\\x1b\\\\)",
    "\\x1b[@-_]",
  ].join("|"),
  "g",
)

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "")
}

function hasNulByte(chunk: Uint8Array): boolean {
  return chunk.includes(0)
}

function replacementRatio(text: string): number {
  if (text.length === 0) {
    return 0
  }

  let replacements = 0
  for (const char of text) {
    if (char === "\uFFFD") {
      replacements++
    }
  }

  return replacements / text.length
}

function appendBytes(left: Uint8Array<ArrayBufferLike>, right: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  if (left.length === 0) {
    return right.slice()
  }

  const combined = new Uint8Array(left.length + right.length)
  combined.set(left, 0)
  combined.set(right, left.length)
  return combined
}

function trimTrailingCarriageReturn(bytes: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  if (bytes.length > 0 && bytes[bytes.length - 1] === 0x0d) {
    return bytes.slice(0, bytes.length - 1)
  }

  return bytes
}

export class LineStream {
  private readonly lineMaxBytes: number
  private readonly binaryThreshold: number
  private readonly decoder = new TextDecoder("utf-8", { fatal: false })
  private pending: Uint8Array<ArrayBufferLike> = new Uint8Array()
  private truncating = false

  constructor(opts: { lineMaxBytes: number; binaryThreshold?: number }) {
    if (!Number.isInteger(opts.lineMaxBytes) || opts.lineMaxBytes < 1) {
      throw new Error("lineMaxBytes must be a positive integer")
    }

    this.lineMaxBytes = opts.lineMaxBytes
    this.binaryThreshold = opts.binaryThreshold ?? DEFAULT_BINARY_THRESHOLD
  }

  feed(chunk: Uint8Array): LineStreamResult {
    if (chunk.length === 0) {
      return { lines: [], binarySuppressedBytes: 0 }
    }

    if (this.isBinaryChunk(chunk)) {
      return {
        lines: [{ text: "", rawText: "", binary: true }],
        binarySuppressedBytes: chunk.byteLength,
      }
    }

    return this.consumeChunk(chunk)
  }

  flush(): LineStreamResult {
    if (this.pending.length === 0) {
      return { lines: [], binarySuppressedBytes: 0 }
    }

    const line = this.createLine(this.pending, this.truncating)
    this.pending = new Uint8Array()
    this.truncating = false
    return { lines: [line], binarySuppressedBytes: 0 }
  }

  private isBinaryChunk(chunk: Uint8Array): boolean {
    if (hasNulByte(chunk)) {
      return true
    }

    const decoded = this.decoder.decode(chunk, { stream: true })
    return replacementRatio(decoded) > this.binaryThreshold
  }

  private consumeChunk(chunk: Uint8Array): LineStreamResult {
    const lines: DecodedLine[] = []
    let segmentStart = 0

    for (let index = 0; index < chunk.length; index++) {
      if (chunk[index] !== 0x0a) {
        continue
      }

      this.consumeBytes(chunk.slice(segmentStart, index), lines)
      this.emitPendingLine(lines)
      segmentStart = index + 1
    }

    this.consumeBytes(chunk.slice(segmentStart), lines)
    return { lines, binarySuppressedBytes: 0 }
  }

  private consumeBytes(bytes: Uint8Array, lines: DecodedLine[]): void {
    if (this.truncating || bytes.length === 0) {
      return
    }

    const remainingBytes = this.lineMaxBytes - this.pending.length
    if (bytes.length <= remainingBytes) {
      this.pending = appendBytes(this.pending, bytes)
      return
    }

    this.pending = appendBytes(this.pending, bytes.slice(0, remainingBytes))
    lines.push(this.createLine(this.pending, true))
    this.pending = new Uint8Array()
    this.truncating = true
  }

  private emitPendingLine(lines: DecodedLine[]): void {
    if (!this.truncating) {
      lines.push(this.createLine(this.pending, false))
    }

    this.pending = new Uint8Array()
    this.truncating = false
  }

  private createLine(bytes: Uint8Array, truncated: boolean): DecodedLine {
    const rawText = new TextDecoder("utf-8", { fatal: false }).decode(trimTrailingCarriageReturn(bytes))
    const line: DecodedLine = {
      text: stripAnsi(rawText),
      rawText,
    }

    if (truncated) {
      line.truncated = true
    }

    return line
  }
}
