import type { Embedder } from "./provider"

const DEFAULT_ENDPOINT = "http://localhost:9642/v1"
const DEFAULT_MODEL = "text-embedding-ada-002"

export interface OpenAICompatibleEmbedderOptions {
  endpoint: string
  model: string
  apiKey?: string
  dimensions: number
}

export class OpenAICompatibleEmbedder implements Embedder {
  private readonly endpoint: string
  private readonly model: string
  private readonly apiKey: string
  private readonly dimensions: number

  constructor(options: OpenAICompatibleEmbedderOptions) {
    this.endpoint = normalizeEndpoint(options.endpoint)
    this.model = options.model
    this.apiKey = options.apiKey ?? ""
    this.dimensions = options.dimensions
  }

  getDimensions(): number {
    return this.dimensions
  }

  async embedText(text: string): Promise<Float32Array> {
    const vectors = await this.embedBatch([text])
    return vectors[0]
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []

    const response = await fetch(`${this.endpoint}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(
        `Embedding request failed (${response.status}): ${response.statusText}${body ? " — " + body.slice(0, 200) : ""}`,
      )
    }

    const json = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>
    }

    if (!Array.isArray(json.data) || json.data.length !== texts.length) {
      throw new Error(
        `Unexpected embedding response: expected data[${texts.length}], got ${JSON.stringify(json.data?.length ?? "missing")}`,
      )
    }

    return json.data.map((item, index) => {
      if (!Array.isArray(item.embedding)) {
        throw new Error(`Missing embedding at index ${index}`)
      }
      return Float32Array.from(item.embedding)
    })
  }
}

function normalizeEndpoint(endpoint?: string): string {
  const trimmed = endpoint ?? ""
  const stripped = trimmed.trim().replace(/\/+$/, "")
  return stripped || DEFAULT_ENDPOINT
}
