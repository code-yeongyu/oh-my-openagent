import type { HostToolContent } from "../../host-contract"
import type { TargetResourceApi } from "../../host-resources"
import type { TargetHookApi, TargetMessageTransformApi, TargetProviderApi, TargetToolGuardApi } from "../../host-hooks"

export type OhMyPiTextContent = {
  type: "text"
  text: string
}

export type OhMyPiToolResult<TDetails = unknown> = {
  content: readonly HostToolContent[]
  details?: TDetails
  isError?: boolean
}

export type OhMyPiCommandContext = {
  cwd: string
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void
  }
}

export type OhMyPiCommandOptions = {
  description?: string
  handler(argument: string, context: OhMyPiCommandContext): Promise<void> | void
}

export type OhMyPiToolDefinition<TDetails = unknown> = {
  name: string
  label: string
  description: string
  parameters: unknown
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<OhMyPiToolResult<TDetails>>
}

export type OhMyPiExtensionApi = TargetResourceApi & TargetHookApi & TargetMessageTransformApi & TargetProviderApi & TargetToolGuardApi & {
  zod: {
    object(shape: Record<string, unknown>): unknown
  }
  setLabel(label: string): void
  registerCommand(name: string, options: OhMyPiCommandOptions): void
  registerTool<TDetails = unknown>(tool: OhMyPiToolDefinition<TDetails>): void
  sendUserMessage(content: string): void | Promise<void>
}
