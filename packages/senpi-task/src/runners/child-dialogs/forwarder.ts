import type { RpcExtensionUIResponse } from "@code-yeongyu/senpi"
import { log } from "@oh-my-opencode/utils"

import { buildAutoUiResponse, type AutoAnswerableUiRequest } from "../rpc/ui-auto-answer"
import {
  CANCELLED,
  forwardableDialogOf,
  forwardedUiResponse,
  type ForwardableDialog,
  type ForwardedAnswer,
} from "./forwardable-dialog"

export type ForwardedChild = {
  readonly taskId: string
  // Aborted when the child task is cancelled or its connection ends; the parent's own teardown is the forwarder's.
  readonly signal: AbortSignal
}

/** Raises a child's dialog on the parent session's UI and resolves with what the person answered there. */
export interface ChildDialogForwarder {
  forward(dialog: ForwardableDialog, child: ForwardedChild): Promise<ForwardedAnswer>
}

export type ChildUiAnswering = {
  readonly forwarder?: ChildDialogForwarder
  readonly taskId: string
}

/**
 * Answers one child UI request without ever blocking the child's record stream: a forwardable dialog waits for the
 * parent's answer (Allow runs, Deny does not), anything else - or a runner with no forwarder - gets today's safe
 * deny/cancel default. A late answer for a child that already went away is dropped.
 */
export function answerChildUiRequest(
  frame: AutoAnswerableUiRequest & Readonly<Record<string, unknown>>,
  answering: ChildUiAnswering | undefined,
  signal: AbortSignal,
  send: (response: RpcExtensionUIResponse) => void | Promise<void>,
): void {
  const dialog = answering?.forwarder === undefined ? undefined : forwardableDialogOf(frame)
  if (answering?.forwarder === undefined || dialog === undefined) {
    const answer = buildAutoUiResponse(frame)
    if (answer !== null) void Promise.resolve(send(answer)).catch((error: unknown) => logFailure(frame, error))
    return
  }
  void answering.forwarder
    .forward(dialog, { taskId: answering.taskId, signal })
    .catch((error: unknown): ForwardedAnswer => {
      log("senpi-task child dialog forward failed", {
        taskId: answering.taskId,
        method: frame.method,
        error: String(error),
      })
      return CANCELLED
    })
    .then(async (answer) => {
      if (signal.aborted) return
      await send(forwardedUiResponse(frame.id, answer))
    })
    .catch((error: unknown) => logFailure(frame, error))
}

function logFailure(frame: AutoAnswerableUiRequest, error: unknown): void {
  log("senpi-task child ui answer failed", { id: frame.id, method: frame.method, error: String(error) })
}
