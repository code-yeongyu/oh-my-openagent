import type { DesktopCapabilities } from "@oh-my-opencode/senpi-desktop-protocol"
import {
  COMPUTER_ACTIONS_TOOL_NAME,
  COMPUTER_TOOL_NAME,
  computerActionsPermissionParser,
  computerPermissionParser,
} from "@oh-my-opencode/senpi-desktop-tool/registration"

import {
  computerUseBackend,
  computerUsePlatform,
  computerUseSessionId,
  sharedComputerUseTelemetryObservers,
  type ComputerUseActivationSource,
  type ComputerUseEngineErrorCode,
  type ComputerUsePermission,
  type ComputerUseTelemetryObservers,
} from "../telemetry/omo-native-computer-use"

export interface ComputerUseTelemetry {
  activation(input: {
    readonly context: unknown
    readonly active: boolean
    readonly source: ComputerUseActivationSource
    readonly backend: unknown
  }): void
  /** `code` is `engineErrorCode(error)`, classified by the runtime that owns the error classes. */
  engineError(context: unknown, code: ComputerUseEngineErrorCode, backend: unknown): void
  osPermissions(context: unknown, capabilities: DesktopCapabilities): void
  toolExecutionStarted(payload: unknown): boolean
  permissionTierDenied(payload: unknown, context: unknown, backend: unknown): void
}

export function createComputerUseTelemetry(options: {
  readonly platform: string
  readonly observers?: ComputerUseTelemetryObservers
}): ComputerUseTelemetry {
  const platform = computerUsePlatform(options.platform)
  const observers = options.observers ?? sharedComputerUseTelemetryObservers()
  const pendingPermissions = new Map<string, ComputerUsePermission>()

  return {
    activation(input) {
      const sessionId = computerUseSessionId(input.context)
      if (sessionId === undefined) return
      observers.publish({
        kind: "activation",
        sessionId,
        active: input.active,
        source: input.source,
        platform,
        backend: computerUseBackend(input.backend),
      })
    },
    engineError(context, code, backend) {
      const sessionId = computerUseSessionId(context)
      if (sessionId === undefined) return
      observers.publish({
        kind: "engine_error",
        sessionId,
        code,
        platform,
        backend: computerUseBackend(backend),
      })
    },
    osPermissions(context, capabilities) {
      const sessionId = computerUseSessionId(context)
      if (sessionId === undefined) return
      const runtime = {
        sessionId,
        platform,
        backend: computerUseBackend(capabilities.backend),
      }
      if (!capabilities.capture) observers.publish({ kind: "permission_denied", ...runtime, scope: "os", permission: "capture" })
      if (!capabilities.input) observers.publish({ kind: "permission_denied", ...runtime, scope: "os", permission: "input" })
      if (!capabilities.ax) observers.publish({ kind: "permission_denied", ...runtime, scope: "os", permission: "ax" })
    },
    toolExecutionStarted(payload) {
      const request = permissionRequest(payload)
      if (request === undefined) return false
      pendingPermissions.set(request.toolCallId, request.permission)
      return true
    },
    permissionTierDenied(payload, context, backend) {
      const event = deniedToolExecution(payload)
      if (event === undefined) return
      const permission = pendingPermissions.get(event.toolCallId)
      if (event.denied || event.final) pendingPermissions.delete(event.toolCallId)
      const sessionId = computerUseSessionId(context)
      if (!event.denied || permission === undefined || sessionId === undefined) return
      observers.publish({
        kind: "permission_denied",
        sessionId,
        scope: "tier",
        permission,
        platform,
        backend: computerUseBackend(backend),
      })
    },
  }
}

function permissionRequest(value: unknown): {
  readonly toolCallId: string
  readonly toolName: string
  readonly permission: ComputerUsePermission
} | undefined {
  if (!isRecord(value) || value.type !== "tool_execution_start") return undefined
  if (typeof value.toolCallId !== "string" || typeof value.toolName !== "string" || !isRecord(value.args)) {
    return undefined
  }
  const permission = permissionForTool(value.toolName, value.args)
  return permission === undefined
    ? undefined
    : { toolCallId: value.toolCallId, toolName: value.toolName, permission }
}

function permissionFrom(requests: readonly { readonly patterns: readonly string[] }[]): ComputerUsePermission | undefined {
  const tier = requests[0]?.patterns[0]
  return tier === "read" || tier === "exec" ? tier : undefined
}

function deniedToolExecution(value: unknown): {
  readonly toolCallId: string
  readonly toolName: string
  readonly denied: boolean
  readonly final: boolean
} | undefined {
  if (!isRecord(value)) return undefined
  if (value.type === "message_end" && isRecord(value.message)) {
    const message = value.message
    if (
      message.role !== "toolResult" ||
      typeof message.toolCallId !== "string" ||
      typeof message.toolName !== "string"
    ) {
      return undefined
    }
    return {
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      denied: message.isError === true && isPermissionPolicyFailure(message),
      final: true,
    }
  }
  if (
    value.type !== "tool_execution_end" ||
    typeof value.toolCallId !== "string" ||
    typeof value.toolName !== "string"
  ) {
    return undefined
  }
  if (!isRecord(value.result)) {
    return { toolCallId: value.toolCallId, toolName: value.toolName, denied: false, final: false }
  }
  return {
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    denied: value.isError === true && isPermissionPolicyFailure(value.result),
    final: false,
  }
}

function permissionForTool(
  toolName: string,
  input: Record<string, unknown>,
): ComputerUsePermission | undefined {
  if (matchesToolName(toolName, COMPUTER_TOOL_NAME)) {
    return permissionFrom(computerPermissionParser(COMPUTER_TOOL_NAME, input, ""))
  }
  if (matchesToolName(toolName, COMPUTER_ACTIONS_TOOL_NAME)) {
    return permissionFrom(computerActionsPermissionParser(COMPUTER_ACTIONS_TOOL_NAME, input, ""))
  }
  return undefined
}

function isPermissionPolicyFailure(result: Record<string, unknown>): boolean {
  if (isRecord(result.details)) {
    const tag = result.details._tag
    if (tag === "PermissionDeniedError" || tag === "PermissionRejectedError" || tag === "PermissionCorrectedError") {
      return true
    }
  }
  if (!Array.isArray(result.content)) return false
  return result.content.some((part) => {
    if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") return false
    return part.text === "The user rejected permission to use this specific tool call." ||
      part.text.startsWith("The user rejected permission to use this specific tool call with the following feedback:") ||
      part.text === "The user has specified a rule which prevents you from using this specific tool call."
  })
}

function matchesToolName(toolName: string, expected: string): boolean {
  const normalized = toolName.trim().toLowerCase().replaceAll("-", "_")
  return normalized === expected || normalized.endsWith(`_${expected}`) || normalized.endsWith(`:${expected}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
