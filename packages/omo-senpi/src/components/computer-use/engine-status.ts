import { DesktopEngineAbiMismatchError } from "@oh-my-opencode/senpi-desktop-engine"
import type { EngineMethod, PermissionDeniedData, StopPathStatus } from "@oh-my-opencode/senpi-desktop-protocol"
import {
  type CallOptions,
  DesktopEngineRpcError,
  DesktopEngineUnavailableError,
  DesktopService,
  DesktopServiceError,
  type DesktopServiceOptions,
  type DesktopSessionOpenParams,
} from "@oh-my-opencode/senpi-desktop-service"

import type { ComputerUseEngineErrorCode } from "../telemetry/omo-native-computer-use"

export type EngineDiagnostic = "native-unavailable" | "quarantined" | "abi-mismatch"

/** What `/computer status` reports as `engine:`; the engine is located and started on first use only. */
export type EngineState = "not started" | "ready" | EngineDiagnostic

export interface TrackedDesktopServiceOptions extends DesktopServiceOptions {
  readonly onError?: (error: Error) => void
  readonly onPermissionRequired?: (permission: Pick<PermissionDeniedData, "permission" | "app">) => void
}

export class ComputerEngineUnavailableError extends Error {
  readonly diagnostic: EngineDiagnostic

  constructor(diagnostic: EngineDiagnostic, cause: Error) {
    super(`Desktop engine unavailable (${diagnostic}): ${cause.message}`, { cause })
    this.name = "ComputerEngineUnavailableError"
    this.diagnostic = diagnostic
  }
}

function diagnosticOf(error: Error): EngineDiagnostic | undefined {
  if (error instanceof DesktopEngineUnavailableError) return error.diagnostic.code
  if (error instanceof DesktopEngineAbiMismatchError) return "abi-mismatch"
  return undefined
}

/** A `DesktopService` that remembers whether its engine started, so status can report it without starting one. */
export class TrackedDesktopService extends DesktopService {
  #engineState: EngineState = "not started"
  readonly #onError: ((error: Error) => void) | undefined
  readonly #onPermissionRequired: TrackedDesktopServiceOptions["onPermissionRequired"]

  constructor(options: TrackedDesktopServiceOptions = {}) {
    super(options)
    this.#onError = options.onError
    this.#onPermissionRequired = options.onPermissionRequired
  }

  get engineState(): EngineState {
    return this.#engineState
  }

  override async open(params: DesktopSessionOpenParams): ReturnType<DesktopService["open"]> {
    try {
      const capabilities = await super.open(params)
      this.#engineState = "ready"
      return capabilities
    } catch (error) {
      if (!(error instanceof Error)) throw error
      this.#report(error)
      const diagnostic = diagnosticOf(error)
      if (diagnostic === undefined) throw error
      this.#engineState = diagnostic
      throw new ComputerEngineUnavailableError(diagnostic, error)
    }
  }

  override async call(method: EngineMethod, params: unknown, options: CallOptions = {}): Promise<unknown> {
    return this.#observe(super.call(method, params, options))
  }

  override ensureStopPath(chord: string): Promise<StopPathStatus> {
    return this.#observe(super.ensureStopPath(chord))
  }

  override stopPathStatus(): Promise<StopPathStatus> {
    return this.#observe(super.stopPathStatus())
  }

  override stop(): Promise<StopPathStatus> {
    return this.#observe(super.stop())
  }

  override resume(): Promise<StopPathStatus> {
    return this.#observe(super.resume())
  }

  async #observe<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation
    } catch (error) {
      if (!(error instanceof Error)) throw error
      this.#report(error)
      throw error
    }
  }

  #report(error: Error): void {
    if (error instanceof DesktopEngineRpcError && error.data !== null && "code" in error.data) {
      if (error.data.code === "PermissionDenied" && error.data.permission != null) {
        this.#onPermissionRequired?.(error.data.permission)
      }
    }
    this.#onError?.(error)
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
