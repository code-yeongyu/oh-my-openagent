import { DesktopEngineAbiMismatchError } from "@oh-my-opencode/senpi-desktop-engine"
import type { DesktopCapabilities } from "@oh-my-opencode/senpi-desktop-protocol"
import {
  DesktopEngineRpcError,
  DesktopEngineUnavailableError,
  DesktopServiceError,
} from "@oh-my-opencode/senpi-desktop-service"
import {
  COMPUTER_ACTIONS_TOOL_NAME,
  COMPUTER_TOOL_NAME,
  computerActionsPermissionParser,
  computerPermissionParser,
} from "@oh-my-opencode/senpi-desktop-tool"

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
  engineError(context: unknown, error: Error, backend: unknown): void
  osPermissions(context: unknown, capabilities: DesktopCapabilities): void
  permissionRequested(toolName: string, input: Record<string, unknown>): void
  toolCall(payload: unknown): boolean
  permissionTierDenied(payload: unknown, context: unknown, backend: unknown): void
}

export function createComputerUseTelemetry(options: {
  readonly platform: string
  readonly observers?: ComputerUseTelemetryObservers
}): ComputerUseTelemetry {
  const platform = computerUsePlatform(options.platform)
  const observers = options.observers ?? sharedComputerUseTelemetryObservers()
  const requestedPermissions = new Map<string, ComputerUsePermission[]>()
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
    engineError(context, error, backend) {
      const sessionId = computerUseSessionId(context)
      if (sessionId === undefined) return
      observers.publish({
        kind: "engine_error",
        sessionId,
        code: engineErrorCode(error),
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
    permissionRequested(toolName, input) {
      const permission = permissionForTool(toolName, input)
      if (permission === undefined) return
      const key = normalizedComputerToolName(toolName)
      if (key === undefined) return
      const queue = requestedPermissions.get(key) ?? []
      queue.push(permission)
      requestedPermissions.set(key, queue)
    },
    toolCall(payload) {
      const request = permissionRequest(payload)
      if (request === undefined) return false
      pendingPermissions.set(
        request.toolCallId,
        takeRequestedPermission(request.toolName, requestedPermissions) ?? request.permission,
      )
      return true
    },
    permissionTierDenied(payload, context, backend) {
      const event = deniedToolExecution(payload)
      if (event === undefined) return
      const permission = pendingPermissions.get(event.toolCallId) ??
        (event.denied ? takeRequestedPermission(event.toolName, requestedPermissions) : undefined)
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

export function engineErrorCode(error: Error): ComputerUseEngineErrorCode {
  if (error instanceof DesktopEngineUnavailableError) return error.diagnostic.code
  if (error instanceof DesktopEngineAbiMismatchError) return "abi-mismatch"
  if (error instanceof DesktopEngineRpcError) {
    return error.data !== null && "code" in error.data ? error.data.code : "other"
  }
  if (error instanceof DesktopServiceError) return error.code
  return "other"
}

function permissionRequest(value: unknown): {
  readonly toolCallId: string
  readonly toolName: string
  readonly permission: ComputerUsePermission
} | undefined {
  if (!isRecord(value) || value.type !== "tool_call") return undefined
  if (typeof value.toolCallId !== "string" || typeof value.toolName !== "string" || !isRecord(value.input)) {
    return undefined
  }
  const permission = permissionForTool(value.toolName, value.input)
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

function normalizedComputerToolName(toolName: string): string | undefined {
  if (matchesToolName(toolName, COMPUTER_TOOL_NAME)) return COMPUTER_TOOL_NAME
  if (matchesToolName(toolName, COMPUTER_ACTIONS_TOOL_NAME)) return COMPUTER_ACTIONS_TOOL_NAME
  return undefined
}

function takeRequestedPermission(
  toolName: string,
  requested: Map<string, ComputerUsePermission[]>,
): ComputerUsePermission | undefined {
  const key = normalizedComputerToolName(toolName)
  if (key === undefined) return undefined
  const queue = requested.get(key)
  const permission = queue?.shift()
  if (queue?.length === 0) requested.delete(key)
  return permission
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
