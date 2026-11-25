import { randomUUID } from "node:crypto"

import {
  parseThreadParams,
  threadToolParamSchemas,
  type ThreadCloseInput,
  type ThreadCreateInput,
  type ThreadInterruptInput,
  type ThreadRenameInput,
  type ThreadSetModelInput,
  type ThreadToolResult,
} from "../contracts"
import { createThread } from "../control/create"
import { locateControl } from "../control/locate"
import { answered, closeOptions, closeThread, interruptThread, NOT_LIVE, setModelOn } from "../control/operations"
import { controlIdentity } from "../control/port"
import { awaitPromptStart, FIRST_PROMPT_START_RESERVE_MS, FIRST_PROMPT_START_WAIT_MS } from "../control/prompt-start"
import { createReceipts } from "../control/receipts"
import { renameThread } from "../control/rename"
import { sendToTarget } from "../sdk-send"
import { UNKNOWN_CALLER } from "../tools/ports"
import { waitWithinCallBudget } from "../../call-budget/call-deadline"
import type { ThreadCoreContext } from "./context"
import { guarded } from "./failures"

type ControlName = "thread_create" | "thread_interrupt" | "thread_close" | "thread_rename" | "thread_set_model"

/**
 * The session controls of the agent tools (thread_create, thread_interrupt, thread_close, thread_rename,
 * thread_set_model): the same arguments, bodies and results, on this device or another of the account. The SDK acts as
 * itself, never as a session, so `self` is `caller_context_missing` and a created thread records no creator.
 */
export function createControls(context: ThreadCoreContext) {
  const { options, principal, store, pipeline, controls, view } = context
  // One session control as its tool runs it: the tool's parameter schema, the receipt protocol its key is honoured by
  // (control/receipts.ts, the one the tools run), then its body; a control's typed refusal is data.
  const receipts = createReceipts(store, context.surface.now ?? store.now)
  type Retrying = { readonly error_note: string | null } | undefined
  function control<I>(
    name: ControlName,
    request: I,
    body: (value: I, key: string, retrying: Retrying) => Promise<ThreadToolResult>,
  ): Promise<ThreadToolResult> {
    return guarded(async () => {
      const parsed = parseThreadParams(threadToolParamSchemas[name], request)
      if (parsed.kind === "error") return parsed as ThreadToolResult
      const value = parsed.value as I & { readonly idempotency_key?: string }
      const key = value.idempotency_key?.trim()
      const scope = {
        principal,
        operation: name,
        idempotency_key: key !== undefined && key.length > 0 ? key : `call:${randomUUID()}`,
      }
      const admission = await receipts.admit(scope, value)
      if (admission.kind === "answer") return admission.result
      let result: ThreadToolResult
      try {
        result = await answered(() => body(value, scope.idempotency_key, admission.retrying))
      } catch (error) {
        await receipts.fail(scope, error instanceof Error ? error.message : String(error))
        throw error
      }
      await receipts.settle(scope, result, admission.retrying)
      return result
    })
  }
  async function located(address: string, allScope: boolean | undefined) {
    return await locateControl(controls, await view(), address, allScope, UNKNOWN_CALLER)
  }
  return {
    create: (request: ThreadCreateInput) =>
      control("thread_create", request, async (value, key, retrying) =>
        createThread(controls, await view(), value, {
          operationId: key,
          callerId: UNKNOWN_CALLER,
          retrying,
          view,
          deliverPrompt: async (_current, target, send, key) => {
            // The script created the thread, so its first prompt carries the creator's authority (#14045), as the tool's does,
            // and goes the way every send of this SDK goes: on another device as the person's own prompt (#15006).
            const sent = await sendToTarget(
              controls,
              pipeline,
              target,
              send,
              key,
              { kind: "operator", uid: options.uid, user: options.user },
              send,
              "creator",
            )
            if (sent.kind === "error") return { kind: "error", error: sent.error }
            const { thread_id, ...facts } = sent
            return { ...facts, thread: thread_id } as ThreadToolResult
          },
          awaitPromptStart: (deliveryId) =>
            awaitPromptStart(
              store,
              deliveryId,
              waitWithinCallBudget(
                options.firstPromptWaitMs ?? FIRST_PROMPT_START_WAIT_MS,
                FIRST_PROMPT_START_RESERVE_MS,
              ),
            ),
        }),
      ),
    interrupt: (request: ThreadInterruptInput) =>
      control("thread_interrupt", request, async (value) => {
        const found = await located(value.thread, value.all_scope)
        if (found.kind === "error") return found.result
        if (found.kind === "not_live") return NOT_LIVE
        return await interruptThread(found.control, value.turn_id)
      }),
    close: (request: ThreadCloseInput) =>
      control("thread_close", request, async (value) => {
        const found = await located(value.thread ?? "self", value.all_scope)
        if (found.kind === "error") return found.result
        // Nothing live holds it: there is nothing to close, and the thread stays resumable from its session file.
        if (found.kind === "not_live")
          return { kind: "ok", ...controlIdentity(found), closed: false, reason: "not_live", dropped_deliveries: [] }
        return await closeThread(found.control, closeOptions(value))
      }),
    rename: (request: ThreadRenameInput) =>
      control("thread_rename", request, async (value, key) =>
        renameThread(controls, await view(), value, key, UNKNOWN_CALLER),
      ),
    setModel: (request: ThreadSetModelInput) =>
      control("thread_set_model", request, async (value) => {
        const found = await located(value.thread, value.all_scope)
        if (found.kind === "error") return found.result
        if (found.kind === "not_live") return NOT_LIVE
        return await setModelOn(found.control, value.model, value.provider)
      }),
  }
}
