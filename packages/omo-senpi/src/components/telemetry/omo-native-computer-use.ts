import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"

import type { SenpiExtensionAPI } from "../../extension/types"
import {
  COMPUTER_USE_ACTIVATION_SOURCES,
  COMPUTER_USE_BACKENDS,
  COMPUTER_USE_ENGINE_ERROR_CODES,
  COMPUTER_USE_PERMISSIONS,
  COMPUTER_USE_PERMISSION_SCOPES,
  COMPUTER_USE_PLATFORMS,
  type OmoNativeEventName,
} from "./event-schemas"
import { hashSessionId } from "./product-identity"

export type ComputerUseActivationSource = (typeof COMPUTER_USE_ACTIVATION_SOURCES)[number]
export type ComputerUseBackend = (typeof COMPUTER_USE_BACKENDS)[number]
export type ComputerUseEngineErrorCode = (typeof COMPUTER_USE_ENGINE_ERROR_CODES)[number]
export type ComputerUsePermission = (typeof COMPUTER_USE_PERMISSIONS)[number]
export type ComputerUsePermissionScope = (typeof COMPUTER_USE_PERMISSION_SCOPES)[number]
export type ComputerUsePlatform = (typeof COMPUTER_USE_PLATFORMS)[number]

type ComputerUseRuntime = {
  readonly backend: ComputerUseBackend
  readonly platform: ComputerUsePlatform
  readonly sessionId: string
}

export type ComputerUseTelemetryObservation =
  | (ComputerUseRuntime & {
    readonly kind: "activation"
    readonly active: boolean
    readonly source: ComputerUseActivationSource
  })
  | (ComputerUseRuntime & {
    readonly kind: "permission_denied"
    readonly permission: ComputerUsePermission
    readonly scope: ComputerUsePermissionScope
  })
  | (ComputerUseRuntime & {
    readonly kind: "engine_error"
    readonly code: ComputerUseEngineErrorCode
  })

type ComputerUseTelemetryObserver = (observation: ComputerUseTelemetryObservation) => void

export interface ComputerUseTelemetryObservers {
  publish(observation: ComputerUseTelemetryObservation): void
  subscribe(observer: ComputerUseTelemetryObserver): () => void
}

const observers = new Set<ComputerUseTelemetryObserver>()
const SHARED_OBSERVERS: ComputerUseTelemetryObservers = {
  publish(observation) {
    for (const observer of observers) observer(observation)
  },
  subscribe(observer) {
    observers.add(observer)
    return () => observers.delete(observer)
  },
}

export function sharedComputerUseTelemetryObservers(): ComputerUseTelemetryObservers {
  return SHARED_OBSERVERS
}

export function registerOmoNativeComputerUseTelemetry(
  pi: SenpiExtensionAPI,
  options: {
    readonly captureEvent: (name: OmoNativeEventName, properties: EventTelemetryProperties) => void
    readonly hashSessionId?: (sessionId: string) => string
    readonly observers?: ComputerUseTelemetryObservers
  },
): void {
  const sessionHash = options.hashSessionId ?? hashSessionId
  const detach = (options.observers ?? sharedComputerUseTelemetryObservers()).subscribe((observation) => {
    const runtime = {
      $session_id: sessionHash(observation.sessionId),
      backend: observation.backend,
      host_platform: observation.platform,
    }
    switch (observation.kind) {
      case "activation":
        options.captureEvent("computer_use_activation", {
          ...runtime,
          active: observation.active,
          source: observation.source,
        })
        return
      case "permission_denied":
        options.captureEvent("computer_use_permission_denied", {
          ...runtime,
          permission: observation.permission,
          scope: observation.scope,
        })
        return
      case "engine_error":
        options.captureEvent("computer_use_engine_error", {
          ...runtime,
          code: observation.code,
        })
        return
      default:
        return assertNever(observation)
    }
  })
  pi.on("session_shutdown", detach)
}

export function computerUsePlatform(value: string): ComputerUsePlatform {
  return value === "darwin" || value === "linux" || value === "win32" ? value : "other"
}

export function computerUseBackend(value: unknown): ComputerUseBackend {
  if (typeof value !== "string") return "other"
  for (const backend of COMPUTER_USE_BACKENDS) if (value === backend) return backend
  return "other"
}

export function computerUseSessionId(context: unknown): string | undefined {
  if (!isRecord(context) || !isRecord(context.sessionManager)) return undefined
  const getSessionId = context.sessionManager.getSessionId
  if (typeof getSessionId !== "function") return undefined
  const sessionId: unknown = getSessionId.call(context.sessionManager)
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined
}

function assertNever(value: never): never {
  throw new TypeError(`unhandled computer-use telemetry observation ${String(value)}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
