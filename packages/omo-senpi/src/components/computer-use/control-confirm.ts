import type { ControlConfirmRequest } from "@oh-my-opencode/senpi-desktop-tool"

/** Bounds the `control.acquire` human confirm; an RPC/desktop client that never answers stays ungranted. */
export const CONTROL_CONFIRM_TIMEOUT_MS = 60_000

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

/**
 * The human confirm behind `computer.control.acquire` (#9651 B5b). Headless contexts never prompt;
 * a refusal, a timeout, or an abort means no grant.
 */
export async function confirmComputerControl(
  _request: ControlConfirmRequest,
  _options: ControlConfirmOptions = {},
): Promise<boolean> {
  // RED stub: the real confirm flow lands with the component implementation commit.
  return false
}
