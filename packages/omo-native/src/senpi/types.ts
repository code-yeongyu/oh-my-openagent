// Wave 0 keeps this seam local because Senpi's full ExtensionAPI currently lives
// under coding-agent internals. Wave 1 should replace this with the public Senpi type.
export type ExtensionFactory = (pi: ExtensionAPI) => void

export interface ExtensionAPI {
  readonly on?: (event: string, handler: ExtensionHandler) => void
  readonly registerTool?: (tool: ToolDefinition) => void
}

export type ExtensionHandler = (event: unknown) => void | Promise<void>

export interface ToolDefinition {
  readonly name: string
  readonly description?: string
}
