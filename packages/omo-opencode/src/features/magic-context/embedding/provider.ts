export interface Embedder {
  embedText(text: string): Promise<Float32Array>
  embedBatch(texts: string[]): Promise<Float32Array[]>
  getDimensions(): number
}
