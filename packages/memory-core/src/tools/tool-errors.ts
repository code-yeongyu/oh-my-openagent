export class MemoryToolError extends Error {
  override readonly name: string = "MemoryToolError"

  constructor(message: string, options?: ErrorOptions) {
    super(message.startsWith("memory:") ? message : `memory: ${message}`, options)
  }
}

export class MemoryStaleReadError extends MemoryToolError {
  override readonly name = "MemoryStaleReadError"

  constructor(
    readonly filePath: string,
    readonly expected: string,
    readonly actual: string | null,
  ) {
    super(
      `${filePath} changed since your read (expected ${expected}, now ${actual ?? "missing"}). Re-read it and retry.`,
    )
  }
}
