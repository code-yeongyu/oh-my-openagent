export class MemoryToolError extends Error {
  // Widened so subclasses can name themselves (MemoryNoChangesError's identity is checked in tests).
  override readonly name: string = "MemoryToolError"

  constructor(message: string, options?: ErrorOptions) {
    super(message.startsWith("memory:") ? message : `memory: ${message}`, options)
  }
}

/**
 * The write's result already equals the stored state. A no-op is a terminal, successful outcome the
 * model must not retry: runMemoryTool converts it to an ok result, so an unchanged update_description
 * ends the attempt instead of surfacing as a tool error (#14814). Callers below runMemoryTool (the
 * human agreements command) still see the throw and report it as a failed command.
 */
export class MemoryNoChangesError extends MemoryToolError {
  override readonly name = "MemoryNoChangesError"
}
