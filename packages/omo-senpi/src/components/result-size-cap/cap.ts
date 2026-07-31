export const RESULT_CAP_THRESHOLD_BYTES = 1_000_000
export const RESULT_CAP_HEAD_CHARS = 800
export const RESULT_CAP_TAIL_CHARS = 400

const CAP_MARKER_RE = /<truncated:\d+ bytes original[^>]*>/

export interface CapTextBlockOptions {
  readonly thresholdBytes?: number
  readonly headChars?: number
  readonly tailChars?: number
}

export interface CappedTextBlock {
  type: string
  text: string
}

interface ContentBlockLike {
  type: string
  text?: unknown
  data?: unknown
}

export interface CappedResultLike {
  readonly content: readonly ContentBlockLike[]
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

function buildMarker(originalBytes: number): string {
  return `<truncated:${originalBytes} bytes original; middle elided to save context - re-run this tool with a narrower range (read offset/limit or a filtered command) to retrieve the elided content>`
}

/**
 * Cap an oversized single text result so no tool output above the threshold
 * can enter the conversation context. Mirrors the core compaction truncation
 * convention (head + marker + tail) so the model gets consistent guidance.
 */
export function capTextBlock(block: CappedTextBlock, options: CapTextBlockOptions = {}): CappedTextBlock {
  const thresholdBytes = options.thresholdBytes ?? RESULT_CAP_THRESHOLD_BYTES
  const headChars = options.headChars ?? RESULT_CAP_HEAD_CHARS
  const tailChars = options.tailChars ?? RESULT_CAP_TAIL_CHARS
  const bytes = utf8Bytes(block.text)
  if (bytes <= thresholdBytes) return block
  if (CAP_MARKER_RE.test(block.text)) return block
  const head = block.text.slice(0, headChars)
  const tail = block.text.slice(block.text.length - tailChars)
  return { ...block, text: `${head}\n${buildMarker(bytes)}\n${tail}` }
}

/**
 * Cap oversized text blocks of a tool result. Image blocks pass through
 * untouched. Returns the same object when nothing exceeded the threshold.
 */
export function capResultContent<T extends CappedResultLike>(result: T, options: CapTextBlockOptions = {}): T {
  let changed = false
  const content = result.content.map((block) => {
    if (block.type !== "text" || typeof block.text !== "string") return block
    const capped = capTextBlock(block as CappedTextBlock, options)
    if (capped !== block) changed = true
    return capped
  })
  if (!changed) return result
  return { ...result, content } as unknown as T
}
