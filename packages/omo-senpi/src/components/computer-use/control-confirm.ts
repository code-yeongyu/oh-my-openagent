import { type ControlConfirmRequest, DEFAULT_TIMEOUT_SECONDS } from "@oh-my-opencode/senpi-desktop-tool"

/**
 * Bounds the `control.acquire` human confirm; an RPC/desktop client that never answers stays ungranted.
 * It ends 15 s before the default run budget, so an unanswered confirm reports `{ active: false }` to the
 * model instead of the run timing out first.
 */
export const CONTROL_CONFIRM_TIMEOUT_MS = (DEFAULT_TIMEOUT_SECONDS - 15) * 1000

/** Title of the foreground-control confirm, upstream oh-my-pi's wording. */
export const CONTROL_CONFIRM_TITLE = "Allow foreground computer control?"

/** Body of the foreground-control confirm: the model's reason plus the revocation and scope rules. */
export function controlConfirmBody(reason: string): string {
  return `${reason}\n\nFor this task only. Interrupt the task or press the computer stop chord to stop and revoke control. This does not authorize external side effects.`
}

/** Fires `onTimeout` after `timeoutMs`; the return cancels it. Injected so tests never wait on a clock. */
export type ControlTimeoutScheduler = (onTimeout: () => void, timeoutMs: number) => () => void

export interface ControlConfirmOptions {
  readonly timeoutMs?: number
  readonly scheduleTimeout?: ControlTimeoutScheduler
}

const realScheduler: ControlTimeoutScheduler = (onTimeout, timeoutMs) => {
  const timer = setTimeout(onTimeout, timeoutMs)
  return () => clearTimeout(timer)
}

/**
 * The human confirm behind `computer.control.acquire` (#9651 B5b). Headless contexts never prompt;
 * a refusal, a timeout, or an abort means no grant. Mirrors senpi's RPC `createDialogPromise`
 * contract (abort or a client that never answers resolves the default `false`) so the run always
 * settles instead of hanging on the human.
 */
export async function confirmComputerControl(
  request: ControlConfirmRequest,
  options: ControlConfirmOptions = {},
): Promise<boolean> {
  const confirm = request.context.ui?.confirm
  if (request.context.hasUI === false || confirm === undefined || request.signal.aborted) return false
  const timeoutMs = options.timeoutMs ?? CONTROL_CONFIRM_TIMEOUT_MS
  const scheduleTimeout = options.scheduleTimeout ?? realScheduler
  return await new Promise<boolean>((resolve) => {
    let settled = false
    const settle = (approved: boolean): void => {
      if (settled) return
      settled = true
      cancelTimeout()
      request.signal.removeEventListener("abort", onAbort)
      resolve(approved)
    }
    const onAbort = (): void => settle(false)
    const cancelTimeout = scheduleTimeout(() => settle(false), timeoutMs)
    request.signal.addEventListener("abort", onAbort, { once: true })
    // The host's own timeout is passed through too, so an RPC client's pending dialog is cleared and
    // a desktop client can show the deadline; the local timer still bounds a host that ignores it.
    Promise.resolve(
      confirm(CONTROL_CONFIRM_TITLE, controlConfirmBody(request.reason), { signal: request.signal, timeout: timeoutMs }),
    ).then(
      (approved) => settle(approved === true),
      () => settle(false),
    )
  })
}
