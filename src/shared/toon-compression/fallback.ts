import { compressForLLM } from "./compressor"
import { getGlobalCompressionConfig } from "./config-store"

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

export function safeCompress(data: unknown, useCase: string): string {
  try {
    const config = getGlobalCompressionConfig()
    return compressForLLM(data, config, useCase)
  } catch {
    return stringifyFallback(data)
  }
}
