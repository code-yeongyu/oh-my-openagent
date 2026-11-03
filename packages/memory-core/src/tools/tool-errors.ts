export class MemoryToolError extends Error {
  override readonly name = "MemoryToolError"

  constructor(message: string, options?: ErrorOptions) {
    super(message.startsWith("memory:") ? message : `memory: ${message}`, options)
  }
}

/** A git hook refused this write's commit: the write was rolled back and the repository is clean again. */
export class MemoryWriteRefusedError extends MemoryToolError {
  readonly reason = "commit_hook_refused"
}
