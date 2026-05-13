export class SovereignError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly originalError?: unknown
  ) {
    super(message)
    this.name = "SovereignError"
    // Restore prototype chain for proper instanceof checks in TS
    Object.setPrototypeOf(this, SovereignError.prototype)
  }
}
