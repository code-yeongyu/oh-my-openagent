import { encode } from "@toon-format/toon"
import type { ToonCompressionConfig } from "./types"

const COMPRESSION_TIMEOUT_MS = 50
const MIN_COMPRESSIBLE_ARRAY_LENGTH = 5
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const ERROR_TEXT_PATTERN = /(error|exception|stack|trace|failed|failure)/i

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stableJsonStringify(data: unknown): string {
  try {
    const serialized = JSON.stringify(data)
    if (typeof serialized === "string") {
      return serialized
    }

    return String(data)
  } catch {
    return String(data)
  }
}

function toPlainTextString(data: unknown): string {
  if (typeof data === "string") {
    return data
  }

  return stableJsonStringify(data)
}

function sortedKeys(value: RecordValue): string[] {
  return Object.keys(value).sort((a, b) => a.localeCompare(b))
}

function hasSameKeys(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }

  return true
}

function isBinaryLikeString(value: string): boolean {
  if (value.length < 128) {
    return false
  }

  if (value.startsWith("data:")) {
    return true
  }

  const normalized = value.replace(/\s+/g, "")
  if (normalized.length % 4 !== 0) {
    return false
  }

  return BASE64_PATTERN.test(normalized)
}

function isBinaryLikeData(data: unknown): boolean {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return true
  }

  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return true
  }

  return typeof data === "string" && isBinaryLikeString(data)
}

function isErrorLikeData(data: unknown): boolean {
  if (typeof data === "string") {
    return ERROR_TEXT_PATTERN.test(data)
  }

  if (!isRecord(data)) {
    return false
  }

  const message = data.message
  if (typeof message === "string" && ERROR_TEXT_PATTERN.test(message)) {
    return true
  }

  const stack = data.stack
  if (typeof stack === "string" && stack.length > 0) {
    return true
  }

  return false
}

function encodeWithTimeout(data: unknown): string {
  const startTime = Date.now()
  const compressed = encode(data)
  const duration = Date.now() - startTime

  if (duration > COMPRESSION_TIMEOUT_MS) {
    throw new Error(`TOON compression timeout: ${duration}ms`)
  }

  return compressed
}

export function isUniformArray(arr: unknown[]): boolean {
  if (arr.length < 2) {
    return false
  }

  const firstItem = arr[0]
  if (!isRecord(firstItem)) {
    return false
  }

  const expectedKeys = sortedKeys(firstItem)
  for (const item of arr) {
    if (!isRecord(item)) {
      return false
    }

    if (!hasSameKeys(expectedKeys, sortedKeys(item))) {
      return false
    }
  }

  return true
}

export function shouldCompress(data: unknown, threshold: number): boolean {
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return false
  }

  if (data === null || data === undefined) {
    return false
  }

  if (isBinaryLikeData(data) || isErrorLikeData(data)) {
    return false
  }

  const payload = toPlainTextString(data)
  if (payload.length <= threshold) {
    return false
  }

  if (!Array.isArray(data)) {
    return false
  }

  if (data.length < MIN_COMPRESSIBLE_ARRAY_LENGTH) {
    return false
  }

  return isUniformArray(data)
}

export function compressForLLM(data: unknown, config: ToonCompressionConfig): string {
  if (!config.enabled || !shouldCompress(data, config.threshold)) {
    return toPlainTextString(data)
  }

  return encodeWithTimeout(data)
}
