export const RESULT_CAP_THRESHOLD_BYTES = 1_000_000
export const RESULT_CAP_AGGREGATE_THRESHOLD_BYTES = 1_000_000
export const RESULT_CAP_HEAD_CHARS = 800
export const RESULT_CAP_TAIL_CHARS = 400

const MIN_THRESHOLD_BYTES = 64

export interface CapTextBlockOptions {
  readonly thresholdBytes?: number
  readonly aggregateThresholdBytes?: number
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

export interface ResultCapMetadata {
  readonly changed: boolean
  readonly originalTextBytes: number
  readonly emittedTextBytes: number
  readonly originalTextBlocks: number
  readonly emittedTextBlocks: number
  readonly cappedBlocks: number
  readonly perBlockCapped: boolean
  readonly aggregateCapped: boolean
}

export interface CappedResultWithMetadata<T> {
  readonly result: T
  readonly metadata: ResultCapMetadata
}

const encoder = new TextEncoder()

function utf8Bytes(text: string): number {
  return encoder.encode(text).length
}

function positiveInteger(name: string, value: number, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer >= ${minimum}`)
  }
  return value
}

function nonNegativeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
  return value
}

function normalizedOptions(options: CapTextBlockOptions): Required<CapTextBlockOptions> {
  return {
    thresholdBytes: positiveInteger("thresholdBytes", options.thresholdBytes ?? RESULT_CAP_THRESHOLD_BYTES, MIN_THRESHOLD_BYTES),
    aggregateThresholdBytes: positiveInteger(
      "aggregateThresholdBytes",
      options.aggregateThresholdBytes ?? RESULT_CAP_AGGREGATE_THRESHOLD_BYTES,
      MIN_THRESHOLD_BYTES,
    ),
    headChars: nonNegativeInteger("headChars", options.headChars ?? RESULT_CAP_HEAD_CHARS),
    tailChars: nonNegativeInteger("tailChars", options.tailChars ?? RESULT_CAP_TAIL_CHARS),
  }
}

function buildMarker(originalBytes: number, scope: "block" | "aggregate"): string {
  return `<truncated:${originalBytes} bytes original; ${scope} middle elided>`
}

function avoidSplitSurrogate(text: string, end: number): number {
  if (end <= 0 || end >= text.length) return end
  const previous = text.charCodeAt(end - 1)
  return previous >= 0xd800 && previous <= 0xdbff ? end - 1 : end
}

function prefixWithinBytes(text: string, maxBytes: number, maxChars = text.length): string {
  if (maxBytes <= 0 || maxChars <= 0) return ""
  let low = 0
  let high = Math.min(text.length, maxChars)
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const safeMiddle = avoidSplitSurrogate(text, middle)
    if (utf8Bytes(text.slice(0, safeMiddle)) <= maxBytes) low = middle
    else high = middle - 1
  }
  return text.slice(0, avoidSplitSurrogate(text, low))
}

function suffixWithinBytes(text: string, maxBytes: number, maxChars = text.length): string {
  if (maxBytes <= 0 || maxChars <= 0) return ""
  const startFloor = Math.max(0, text.length - maxChars)
  let low = startFloor
  let high = text.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    let safeMiddle = middle
    const current = text.charCodeAt(safeMiddle)
    if (current >= 0xdc00 && current <= 0xdfff) safeMiddle += 1
    if (utf8Bytes(text.slice(safeMiddle)) <= maxBytes) high = middle
    else low = middle + 1
  }
  let start = low
  const current = text.charCodeAt(start)
  if (current >= 0xdc00 && current <= 0xdfff) start += 1
  return text.slice(start)
}

function boundedProjection(text: string, originalBytes: number, thresholdBytes: number, headChars: number, tailChars: number, scope: "block" | "aggregate"): string {
  const marker = buildMarker(originalBytes, scope)
  const separatorBytes = 2
  const available = Math.max(0, thresholdBytes - utf8Bytes(marker) - separatorBytes)
  const headBudget = Math.ceil(available / 2)
  const tailBudget = available - headBudget
  const head = prefixWithinBytes(text, headBudget, headChars)
  const tail = suffixWithinBytes(text, tailBudget, tailChars)
  return `${head}\n${marker}\n${tail}`
}

export function capTextBlock(block: CappedTextBlock, options: CapTextBlockOptions = {}): CappedTextBlock {
  const normalized = normalizedOptions(options)
  const bytes = utf8Bytes(block.text)
  if (bytes <= normalized.thresholdBytes) return block
  return {
    ...block,
    text: boundedProjection(
      block.text,
      bytes,
      normalized.thresholdBytes,
      normalized.headChars,
      normalized.tailChars,
      "block",
    ),
  }
}

function aggregateProjection(
  textBlocks: readonly CappedTextBlock[],
  originalBytes: number,
  thresholdBytes: number,
  headChars: number,
  tailChars: number,
): string {
  const marker = buildMarker(originalBytes, "aggregate")
  const available = Math.max(0, thresholdBytes - utf8Bytes(marker) - 2)
  let headBudget = Math.ceil(available / 2)
  let tailBudget = available - headBudget
  const heads: string[] = []
  const tails: string[] = []

  for (const block of textBlocks) {
    if (headBudget <= 0) break
    const chunk = prefixWithinBytes(block.text, headBudget, headChars)
    if (chunk.length === 0) continue
    heads.push(chunk)
    headBudget -= utf8Bytes(chunk)
  }
  for (let index = textBlocks.length - 1; index >= 0 && tailBudget > 0; index -= 1) {
    const block = textBlocks[index]
    if (block === undefined) continue
    const chunk = suffixWithinBytes(block.text, tailBudget, tailChars)
    if (chunk.length === 0) continue
    tails.unshift(chunk)
    tailBudget -= utf8Bytes(chunk)
  }
  return `${heads.join("")}\n${marker}\n${tails.join("")}`
}

export function capResultContentWithMetadata<T extends CappedResultLike>(
  result: T,
  options: CapTextBlockOptions = {},
): CappedResultWithMetadata<T> {
  const normalized = normalizedOptions(options)
  let changed = false
  let cappedBlocks = 0
  let originalTextBytes = 0
  let emittedTextBytes = 0
  let originalTextBlocks = 0

  let content = result.content.map((block) => {
    if (block.type !== "text" || typeof block.text !== "string") return block
    originalTextBlocks += 1
    originalTextBytes += utf8Bytes(block.text)
    const capped = capTextBlock(block as CappedTextBlock, normalized)
    if (capped !== block) {
      changed = true
      cappedBlocks += 1
    }
    emittedTextBytes += utf8Bytes(capped.text)
    return capped
  })

  let aggregateCapped = false
  if (emittedTextBytes > normalized.aggregateThresholdBytes && originalTextBlocks > 0) {
    aggregateCapped = true
    changed = true
    const textBlocks = content.filter(
      (block): block is CappedTextBlock => block.type === "text" && typeof block.text === "string",
    )
    const aggregateText = aggregateProjection(
      textBlocks,
      originalTextBytes,
      normalized.aggregateThresholdBytes,
      normalized.headChars,
      normalized.tailChars,
    )
    let inserted = false
    content = content.flatMap((block) => {
      if (block.type !== "text" || typeof block.text !== "string") return [block]
      if (inserted) return []
      inserted = true
      return [{ ...block, text: aggregateText }]
    })
    emittedTextBytes = utf8Bytes(aggregateText)
  }

  const cappedResult = changed ? ({ ...result, content } as unknown as T) : result
  return {
    result: cappedResult,
    metadata: {
      changed,
      originalTextBytes,
      emittedTextBytes,
      originalTextBlocks,
      emittedTextBlocks: content.filter((block) => block.type === "text" && typeof block.text === "string").length,
      cappedBlocks,
      perBlockCapped: cappedBlocks > 0,
      aggregateCapped,
    },
  }
}

export function capResultContent<T extends CappedResultLike>(result: T, options: CapTextBlockOptions = {}): T {
  return capResultContentWithMetadata(result, options).result
}
