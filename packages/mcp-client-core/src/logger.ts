export type McpClientLogger = (message: string, data?: unknown) => void

let activeLogger: McpClientLogger = () => undefined

export function log(message: string, data?: unknown): void {
  activeLogger(message, data)
}

export function setMcpClientLoggerForTesting(logger?: McpClientLogger): void {
  activeLogger = logger ?? (() => undefined)
}
