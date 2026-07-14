import type { Embedder } from "./provider"
import { OpenAICompatibleEmbedder } from "./openai-compatible"
import { LocalHuggingFaceEmbedder } from "./local-huggingface"

export interface EmbedderConfig {
  provider: "openai-compatible" | "local" | "mock"
  model?: string
  endpoint?: string
  apiKey?: string
  dimensions?: number
}

export function createEmbedder(config: EmbedderConfig = { provider: "openai-compatible" }): Embedder {
  const provider = config.provider || "openai-compatible"

  switch (provider) {
    case "local": {
      return new LocalHuggingFaceEmbedder({
        model: config.model,
        dimensions: config.dimensions,
      })
    }
    case "mock": {
      return new MockEmbedder(config.dimensions ?? 384)
    }
    case "openai-compatible":
    default: {
      return new OpenAICompatibleEmbedder({
        endpoint: config.endpoint || "http://localhost:9642/v1",
        model: config.model || "text-embedding-ada-002",
        apiKey: config.apiKey,
        dimensions: config.dimensions ?? 384,
      })
    }
  }
}

class MockEmbedder implements Embedder {
  private readonly dimensions: number

  constructor(dimensions: number) {
    this.dimensions = dimensions
  }

  getDimensions(): number {
    return this.dimensions
  }

  async embedText(text: string): Promise<Float32Array> {
    return this.hashToVector(text)
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.hashToVector(t))
  }

  // Bag-of-words hashing: each token maps to a deterministic dimension, so
  // texts that share tokens produce overlapping (non-orthogonal) vectors. This
  // makes the mock provider usable as a local search fallback instead of a
  // pure smoke-test placeholder whose every distinct string is orthogonal.
  private hashToVector(text: string): Float32Array {
    const vec = new Float32Array(this.dimensions)

    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
    if (tokens.length === 0) {
      let hash = 0
      for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i)
        hash |= 0
      }
      let seed = Math.abs(hash)
      for (let i = 0; i < this.dimensions; i++) {
        seed = (seed * 1103515245 + 12345) | 0
        const unsigned = seed >>> 0
        vec[i] = (unsigned % 100000) / 100000
      }
    } else {
      for (const token of tokens) {
        let hash = 0
        for (let i = 0; i < token.length; i++) {
          hash = ((hash << 5) - hash) + token.charCodeAt(i)
          hash |= 0
        }
        const idx = Math.abs(hash) % this.dimensions
        vec[idx] += 1
      }
    }

    let norm = 0
    for (let i = 0; i < this.dimensions; i++) {
      norm += vec[i] * vec[i]
    }
    norm = Math.sqrt(norm)
    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        vec[i] /= norm
      }
    }

    return vec
  }
}
