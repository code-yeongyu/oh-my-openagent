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
    try {
      return String(data)
    } catch {
      return "[unserializable]"
    }
  }
}

export function safeCompress(data: unknown, config: ToonCompressionConfig, useCase: string): string {
  try {
    return compressForLLM(data, config, useCase)
  } catch {
    return stringifyFallback(data)
  }
}
