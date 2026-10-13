export class V2UnsupportedOperationError extends Error {
  readonly operation: string

  constructor(operation: string) {
    super(
      `${operation} is not available on OpenCode 2.x yet. ` +
        "The oh-my-openagent V2 adapter implements the V1 client methods it can map; this one has no mapping.",
    )
    this.name = "V2UnsupportedOperationError"
    this.operation = operation
  }
}
