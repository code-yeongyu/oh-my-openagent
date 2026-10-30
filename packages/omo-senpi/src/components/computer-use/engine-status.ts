import {
  DesktopEngineAbiMismatchError,
  DesktopLaunchContextError,
  type UserFacingErrorInfo,
} from "@oh-my-opencode/senpi-desktop-engine"
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

export type EngineDiagnostic = "native-unavailable" | "quarantined" | "abi-mismatch" | "launch-context-unavailable"

/** What `/computer status` reports as `engine:`; the engine is located and started on first use only. */
export type EngineState = "not started" | "ready" | EngineDiagnostic

export interface TrackedDesktopServiceOptions extends DesktopServiceOptions {
  readonly onError?: (error: Error) => void
  readonly onPermissionRequired?: (permission: Pick<PermissionDeniedData, "permission" | "app">) => void
}

const SEE_STATUS = "`/computer status` shows the details."

function userFacingUnavailable(diagnostic: EngineDiagnostic, cause: Error): UserFacingErrorInfo {
  if (cause instanceof DesktopEngineAbiMismatchError || cause instanceof DesktopLaunchContextError) return cause.userFacing
  if (diagnostic === "quarantined") {
    return {
      code: "COMPUTER_ENGINE_QUARANTINED",
      message: "macOS Gatekeeper is blocking the computer-use engine that ships with OmO.",
      action: `Reinstall OmO with \`omo update\`, then try again. ${SEE_STATUS}`,
    }
  }
  if (cause instanceof DesktopEngineUnavailableError && cause.diagnostic.reason === "no-release-asset") {
    return {
      code: "COMPUTER_UNSUPPORTED_PLATFORM",
      message: `Computer use is not available on this platform (${cause.diagnostic.host}).`,
      action: `Use computer use from a platform OmO ships the engine for. ${SEE_STATUS}`,
    }
  }
  return {
    code: "COMPUTER_ENGINE_UNAVAILABLE",
    message: "The computer-use engine is missing from this OmO install.",
    action: `Reinstall OmO with \`omo update\`, then try again. ${SEE_STATUS}`,
  }
}

export class ComputerEngineUnavailableError extends Error {
  readonly diagnostic: EngineDiagnostic
  readonly userFacing: UserFacingErrorInfo

  constructor(diagnostic: EngineDiagnostic, cause: Error) {
    super(`Desktop engine unavailable (${diagnostic}): ${cause.message}`, { cause })
    this.name = "ComputerEngineUnavailableError"
    this.diagnostic = diagnostic
    this.userFacing = userFacingUnavailable(diagnostic, cause)
  }
}

function diagnosticOf(error: Error): EngineDiagnostic | undefined {
  if (error instanceof DesktopEngineUnavailableError) return error.diagnostic.code
  if (error instanceof DesktopEngineAbiMismatchError) return "abi-mismatch"
  if (error instanceof DesktopLaunchContextError) return error.code
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
    // Failures nobody awaits (a best-effort revoke, a heartbeat, a malformed notification) reach the
    // service's error hub, never a caller; without this they would go nowhere (#9967).
    this.onError((error) => this.#report(error))
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
      if (error instanceof DesktopLaunchContextError) throw error
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
      const result = await operation
      // A retried launch can recover; an unrelated reply cannot repair a binary/ABI failure.
      if (this.#engineState === "not started" || this.#engineState === "launch-context-unavailable") {
        this.#engineState = "ready"
      }
      return result
    } catch (error) {
      if (!(error instanceof Error)) throw error
      this.#report(error)
      throw error
    }
  }

  #report(error: Error): void {
    const diagnostic = diagnosticOf(error)
    if (diagnostic !== undefined) this.#engineState = diagnostic
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
