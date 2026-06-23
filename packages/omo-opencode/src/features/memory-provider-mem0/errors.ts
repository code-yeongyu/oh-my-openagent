export class Mem0L2AdapterError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message)
    this.name = "Mem0L2AdapterError"
  }
}
