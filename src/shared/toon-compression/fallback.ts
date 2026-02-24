import type { ToonCompressionConfig } from "./types"
import { compressForLLM } from "./compressor"

function stringifyFallback(data: unknown): string {
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

export function safeCompress(data: unknown, config: ToonCompressionConfig): string {
  try {
    return compressForLLM(data, config)
  } catch {
    return stringifyFallback(data)
  }
}
