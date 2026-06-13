import type { HostToolContent } from "../../host-contract"
import type { TargetResourceApi } from "../../host-resources"
import type { TargetHookApi, TargetMessageTransformApi, TargetProviderApi, TargetToolGuardApi } from "../../host-hooks"

export type PiTextContent = {
  type: "text"
  text: string
}

export type PiToolResult<TDetails = unknown> = {
  content: readonly HostToolContent[]
  details?: TDetails
  isError?: boolean
}

export type PiCommandContext = {
  cwd: string
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void
  }
}

export type PiCommandOptions = {
  description?: string
  handler(argument: string, context: PiCommandContext): Promise<void> | void
}

export type PiToolDefinition<TDetails = unknown> = {
  name: string
  label: string
  description: string
  parameters: unknown
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<PiToolResult<TDetails>>
}

export type PiExtensionApi = TargetResourceApi & TargetHookApi & TargetMessageTransformApi & TargetProviderApi & TargetToolGuardApi & {
  registerCommand(name: string, options: PiCommandOptions): void
  registerTool<TDetails = unknown>(tool: PiToolDefinition<TDetails>): void
  sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): void | Promise<void>
}
