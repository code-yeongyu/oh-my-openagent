export class MemoryToolError extends Error {
  override readonly name = "MemoryToolError"

  constructor(message: string, options?: ErrorOptions) {
    super(message.startsWith("memory:") ? message : `memory: ${message}`, options)
  }
}
