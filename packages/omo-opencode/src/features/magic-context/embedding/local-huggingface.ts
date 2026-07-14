import type { Embedder } from "./provider"

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2"
const DEFAULT_DIMENSIONS = 384

export interface LocalHuggingFaceEmbedderOptions {
  model?: string
  dimensions?: number
}

export class LocalHuggingFaceEmbedder implements Embedder {
  private readonly model: string
  private readonly dimensions: number
  private pipeline: ((input: string | string[], options: { pooling: string; normalize: boolean }) => Promise<unknown>) | null = null
  private loadPromise: Promise<void> | null = null

  constructor(options: LocalHuggingFaceEmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL
    this.dimensions = options.dimensions ?? DEFAULT_DIMENSIONS
  }

  getDimensions(): number {
    return this.dimensions
  }

  async embedText(text: string): Promise<Float32Array> {
    const pipe = await this.getPipeline()
    const result = await pipe(text, { pooling: "mean", normalize: true })
    const vector = extractEmbedding(result)
    return vector
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []
    const pipe = await this.getPipeline()
    const result = await pipe(texts, { pooling: "mean", normalize: true })

    if (Array.isArray(result)) {
      return result.map((item) => extractEmbedding(item))
    }

    const dims = extractDims(result)
    const data = extractData(result)
    const lastDim = dims?.[dims.length - 1] ?? data.length / texts.length

    if (Number.isInteger(lastDim) && data.length === texts.length * lastDim) {
      const embeddings: Float32Array[] = []
      for (let i = 0; i < texts.length; i++) {
        const start = i * lastDim
        const slice = new Float32Array(lastDim)
        for (let j = 0; j < lastDim; j++) {
          slice[j] = data[start + j]
        }
        embeddings.push(slice)
      }
      return embeddings
    }

    return [extractEmbedding(result)]
  }

  private async getPipeline(): Promise<(input: string | string[], options: { pooling: string; normalize: boolean }) => Promise<unknown>> {
    if (this.pipeline) return this.pipeline
    if (this.loadPromise) {
      await this.loadPromise
      return this.pipeline!
    }

    this.loadPromise = this.loadPipeline()
    await this.loadPromise
    return this.pipeline!
  }

  private async loadPipeline(): Promise<void> {
    try {
      const spec = `@huggingface/${"transformers"}`
      const mod = (await import(spec)) as {
        pipeline: (
          task: string,
          model: string,
          options?: Record<string, unknown>,
        ) => Promise<unknown>
      }

      const pipelineFn = mod.pipeline
      this.pipeline = await pipelineFn("feature-extraction", this.model, {
        dtype: "fp32",
      }) as (input: string | string[], options: { pooling: string; normalize: boolean }) => Promise<unknown>
    } catch (error) {
      this.loadPromise = null
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Cannot load HuggingFace embedding model "${this.model}". ` +
        `Run \`bun add @huggingface/transformers\` to install the dependency. ` +
        `Error: ${message}`,
      )
    }
  }
}

function extractEmbedding(result: unknown): Float32Array {
  const data = extractData(result)
  return Float32Array.from(data)
}

function extractData(result: unknown): ArrayLike<number> {
  if (!result || typeof result !== "object") {
    throw new Error("Unexpected embedding output: not an object")
  }
  const data = (result as Record<string, unknown>).data as ArrayLike<number> | undefined
  if (!data || typeof data !== "object" || !("length" in data)) {
    throw new Error("Unexpected embedding output: missing data field")
  }
  return data
}

function extractDims(result: unknown): number[] | undefined {
  if (!result || typeof result !== "object") return undefined
  const dims = (result as Record<string, unknown>).dims
  if (Array.isArray(dims) && dims.every((d) => typeof d === "number")) {
    return dims as number[]
  }
  return undefined
}
