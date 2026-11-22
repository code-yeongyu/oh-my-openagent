import type {
  ComputerCallPolicy,
  ComputerDisplay,
  ComputerScreenshot,
  ComputerSessionSnapshot,
  EngineMethod,
  RpcPort,
} from "@oh-my-opencode/senpi-desktop-protocol"
import { type Computer, ComputerError, connect } from "@oh-my-opencode/senpi-desktop-sdk"
import { DesktopServiceError } from "../service/rpc-client"

/** Why a computer run failed inside the runtime; engine failures surface as `DesktopEngineRpcError`. */
export type ComputerRunErrorReason =
  | "readOnly"
  | "timeout"
  | "aborted"
  | "ended"
  | "assertion"
  | "window"
  | "wait"
  | "unavailable"
  // QuickJS run cell limits (run/sandbox): fatal to the run, except `payloadSize`, which rejects one bridged call.
  | "calls"
  | "memory"
  | "stack"
  | "payloadSize"
  | "stalled"
  | "crashed"

export class ComputerRunError extends Error {
  readonly reason: ComputerRunErrorReason

  constructor(reason: ComputerRunErrorReason, message: string) {
    super(message)
    this.name = "ComputerRunError"
    this.reason = reason
  }
}

/** Ordered text and image entries shown to the model; an accumulator, so it is mutable by design. */
export class RunOutput {
  readonly #entries: ComputerDisplay[] = []

  text(text: string): void {
    this.#entries.push({ type: "text", text })
  }

  image(data: string, mimeType: string): void {
    this.#entries.push({ type: "image", data, mimeType })
  }

  finish(): readonly ComputerDisplay[] {
    return [...this.#entries]
  }
}

/**
 * The state one run owns. Each run gets its own vm context and a facade bound to this object, so
 * async work leaked from an ended run keeps that run's aborted signal and read-only policy instead of
 * borrowing the next run's (what oh-my-pi's AsyncLocalStorage run context guarded against).
 */
export interface RunContext {
  /** Aborts on the caller's signal, the run timeout, or the end of the run. */
  readonly signal: AbortSignal
  readonly readOnly: boolean
  readonly snapshot: ComputerSessionSnapshot
  readonly output: RunOutput
  /** Artifacts written during the run; appended by `screenshot()`. */
  readonly screenshots: ComputerScreenshot[]
  /** Epoch ms when the run budget ends; a human confirm must answer before it. */
  readonly deadline: number
}

/** One engine request on behalf of the run, carrying the run signal. */
export type EngineCall = (method: EngineMethod, params: object) => Promise<unknown>

/** Returns `promise` after arranging for user code awaiting it to resume once it settles. */
export type Resume = <T>(promise: Promise<T>) => Promise<T>

/**
 * The human confirmation behind `desktop.control.acquire`; absent on a headless run, which then
 * never grants (#9651 B5b). `budgetMs` is how long the run can still wait for the answer.
 */
export type ConfirmControl = (reason: string, signal: AbortSignal, budgetMs: number) => Promise<boolean>

/** What every facade method needs: the run it belongs to, its engine channel, and the vm resume hook. */
export interface RunScope {
  readonly context: RunContext
  readonly call: EngineCall
  readonly resume: Resume
  readonly confirmControl?: ConfirmControl
}

/** Tier table of one facade surface (`DESKTOP_METHODS`, `WINDOW_METHODS`, `ELEMENT_METHODS`). */
export type MethodTiers = Readonly<Record<string, ComputerCallPolicy>>

/**
 * Admits one facade call: refuses `exec` methods in a read-only run and anything after the run
 * ended. A method missing from `tiers` counts as `exec`, so a new helper fails closed.
 */
export function guardRun(context: RunContext, tiers: MethodTiers, method: string): void {
  const tier = Object.hasOwn(tiers, method) ? tiers[method] : "exec"
  if (context.readOnly && tier === "exec") {
    throw new ComputerRunError("readOnly", `read-only run: '${method}' requires read_only: false`)
  }
  context.signal.throwIfAborted()
}

/** Shape check of one engine reply, applied before the SDK parses it so a malformed reply fails as it always has. */
export type ReplyGuard = (value: unknown) => boolean

/** One SDK connection for one facade call; `reply` is the raw engine reply of `method` within this connection. */
export interface SdkCall {
  readonly computer: Computer
  reply(method: EngineMethod): unknown
}

/**
 * An SDK `Computer` over the run's engine channel (`scope.call`, which carries the run signal). Each facade call
 * opens its own, so the raw replies it keeps belong to that call alone; opening sends nothing.
 */
export async function openSdk(
  scope: RunScope,
  guards: Readonly<Partial<Record<EngineMethod, ReplyGuard>>>,
): Promise<SdkCall> {
  const replies = new Map<EngineMethod, unknown>()
  const port: RpcPort = {
    call: async (method, params) => {
      const value = await scope.call(method, params as object)
      const guard = guards[method]
      if (guard !== undefined && !guard(value)) {
        throw new DesktopServiceError("Internal", `desktop engine sent a malformed ${method} result`)
      }
      replies.set(method, value)
      return value
    },
    notifications: { subscribe: () => () => undefined },
    close: async () => undefined,
  }
  return { computer: await connect({ kind: "inProcess", port }), reply: (method) => replies.get(method) }
}

/**
 * The run's own error for an SDK failure: an engine or channel failure is the original error the SDK wrapped, and
 * a reply only the SDK's stricter parser rejects is the malformed-result error of `method`.
 */
function runErrorOf(error: unknown, method: EngineMethod): unknown {
  if (!(error instanceof ComputerError)) return error
  if (error.cause !== undefined) return error.cause
  if (error.data.reason === "malformed_result") {
    return new DesktopServiceError("Internal", `desktop engine sent a malformed ${method} result`)
  }
  return error
}

/** `work` over the SDK, with failures mapped by `runErrorOf`. */
export async function viaSdk<T>(method: EngineMethod, work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw runErrorOf(error, method)
  }
}

/** Runs one facade method of a surface: guarded, never throwing synchronously, and resuming the vm. */
export type FacadeMethod = <T>(method: string, work: (scope: RunScope) => Promise<T> | T) => Promise<T>

/**
 * The single entry of every facade method on one surface (`tiers`). Even a guard refusal or a bad
 * argument settles the returned promise, and that promise resumes the vm, so user code awaiting it
 * always continues.
 */
export function facadeMethod(scope: RunScope, tiers: MethodTiers): FacadeMethod {
  return (method, work) =>
    scope.resume(
      Promise.resolve().then(() => {
        guardRun(scope.context, tiers, method)
        return work(scope)
      }),
    )
}
