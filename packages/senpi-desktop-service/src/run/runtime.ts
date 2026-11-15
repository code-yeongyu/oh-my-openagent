import type {
  AuditEvent,
  AuditRecord,
  ComputerRunOk,
  ComputerSessionSnapshot,
} from "@oh-my-opencode/senpi-desktop-protocol"
import type { DesktopService } from "../service/service"
import { ComputerRunError, type ConfirmControl, type EngineCall, type RunContext, RunOutput } from "./context"
import { createDesktopFacade, type DesktopFacade } from "./facade"
import { sleep } from "./wait"

export interface ComputerCallRequest {
  /** The tool call this work belongs to; every audit record it produces is tagged with it. */
  readonly toolCallId: string
  readonly snapshot: ComputerSessionSnapshot
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

/** `DesktopService` surface used by the facade; `control.grant`/`revoke` stay host-only. */
export interface ComputerCallHost {
  readonly service: Pick<DesktopService, "call" | "auditBarrier" | "onAudit" | "revokeControl" | "reportError">
  /** Human confirmation behind `desktop.control.acquire`; absent: headless, never grants (#9651 B5b). */
  readonly confirmControl?: ConfirmControl
}

/** What a step program reaches: the desktop facade, and a sleep cancelled with the call. */
export interface StepScope {
  readonly desktop: DesktopFacade
  readonly sleep: (ms: number) => Promise<void>
}

/** Host-written steps over the facade (a call chain, a CUA batch); no model-written code runs in this process. */
export type StepProgram = (scope: StepScope) => Promise<unknown>

/** A return value detached from the facade's objects: structured-cloneable as-is, else JSON, else `String`. */
function cloneSafe(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    return structuredClone(value)
  } catch (error) {
    if (!(error instanceof DOMException)) throw error
  }
  try {
    return JSON.parse(JSON.stringify(value) ?? "null")
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    return String(value)
  }
}

function auditRecord(event: AuditEvent, sessionId: string, toolCallId: string): AuditRecord {
  const { action, target, delivery, durationMs, focusRestored, textLength, textSha256, keys } = event
  const code = event.code ?? null
  return {
    timestamp: new Date().toISOString(),
    sessionId,
    toolCallId,
    action,
    target,
    delivery,
    frameId: event.frameId ?? null,
    code,
    status: code === null ? "success" : code === "Suspended" ? "suspended" : "error",
    durationMs,
    ...(focusRestored == null ? {} : { focusRestored }),
    ...(textLength == null ? {} : { textLength }),
    ...(textSha256 == null ? {} : { textSha256 }),
    ...(keys == null ? {} : { keys }),
  }
}

/**
 * Runs one tool call's `program` against a desktop facade bound to this call: the call's signal aborts on the
 * caller's signal, on `timeoutMs`, and when the call ends, and every engine request carries it. Displays,
 * screenshot artifacts, and the engine's audit events received meanwhile are collected for the result.
 */
export async function runComputerSteps(
  request: ComputerCallRequest,
  host: ComputerCallHost,
  program: StepProgram,
): Promise<ComputerRunOk> {
  const { snapshot, timeoutMs, toolCallId } = request
  const controller = new AbortController()
  const { signal } = controller
  const fail = (reason: unknown) => controller.abort(reason)
  const timer = setTimeout(
    () => fail(new ComputerRunError("timeout", `computer call timed out after ${timeoutMs} ms`)),
    timeoutMs,
  )
  const onCallerAbort = () => fail(new ComputerRunError("aborted", "computer call was aborted"))
  request.signal?.addEventListener("abort", onCallerAbort, { once: true })
  if (request.signal?.aborted) onCallerAbort()
  const audit: AuditRecord[] = []
  const unsubscribe = host.service.onAudit((event) => audit.push(auditRecord(event, snapshot.sessionId, toolCallId)))
  const context: RunContext = {
    signal,
    readOnly: snapshot.readOnly,
    snapshot,
    output: new RunOutput(),
    screenshots: [],
    deadline: Date.now() + timeoutMs,
  }
  let sent = false
  const call: EngineCall = (method, params) => {
    sent = true
    return host.service.call(method, params, { signal })
  }
  const desktop = createDesktopFacade({
    context,
    call,
    ...(host.confirmControl === undefined ? {} : { confirmControl: host.confirmControl }),
  })
  try {
    signal.throwIfAborted()
    const returnValue = await new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      // The audit of the call's last request arrives after that request's reply; collect it before settling.
      program({ desktop, sleep: (ms) => sleep(ms, signal) })
        .then(async (value) => {
          if (sent) await host.service.auditBarrier({ signal, timeoutMs: Math.max(1, context.deadline - Date.now()) })
          return value
        })
        .then(resolve, reject)
    })
    return {
      displays: context.output.finish(),
      returnValue: cloneSafe(returnValue),
      screenshots: [...context.screenshots],
      audit: [...audit],
    }
  } catch (error) {
    // A failed call revokes the control grant (lead add (a) of #9651), so the next foreground action asks the
    // human again; an interrupted (aborted) call lands here too. The revoke is written to the engine's serial
    // queue before the call settles, so nothing sent afterwards can overtake it. Engine failures reach the error
    // hub inside revokeControl; anything else it rethrows is a bug and is reported there too (#9967).
    void host.service.revokeControl().catch((failure: unknown) => host.service.reportError(failure))
    throw error
  } finally {
    clearTimeout(timer)
    request.signal?.removeEventListener("abort", onCallerAbort)
    unsubscribe()
    if (!signal.aborted) controller.abort(new ComputerRunError("ended", "computer call has ended"))
  }
}
