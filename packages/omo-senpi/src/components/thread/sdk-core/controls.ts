import { randomUUID } from "node:crypto"

import {
  DEFAULT_THREAD_DELIVERY,
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
import { notLiveAnswer } from "../control/not-live"
import { awaitPromptStart, FIRST_PROMPT_START_RESERVE_MS, FIRST_PROMPT_START_WAIT_MS } from "../control/prompt-start"
import { renameThread } from "../control/rename"
import { UNKNOWN_CALLER } from "../tools/ports"
import { waitWithinCallBudget } from "../../call-budget/call-deadline"
import type { ThreadCoreContext } from "./context"
import { guarded } from "./failures"

type ControlSchema = (typeof threadToolParamSchemas)[
  "thread_create" | "thread_interrupt" | "thread_close" | "thread_rename" | "thread_set_model"]

/**
 * The session controls of the agent tools (thread_create, thread_interrupt, thread_close, thread_rename,
 * thread_set_model): the same arguments, bodies and results, on this device or another of the account. The SDK acts as
 * itself, never as a session, so `self` is `caller_context_missing` and a created thread records no creator.
 */
export function createControls(context: ThreadCoreContext) {
  const { options, principal, store, pipeline, controls, view } = context
  // One session control as its tool runs it: the tool's parameter schema, then its body, a control's typed refusal as data.
  function control<I>(
    schema: ControlSchema,
    request: I,
    body: (value: I) => Promise<ThreadToolResult>,
  ): Promise<ThreadToolResult> {
    return guarded(async () => {
      const parsed = parseThreadParams(schema, request)
      if (parsed.kind === "error") return parsed as ThreadToolResult
      return await answered(() => body(parsed.value as I))
    })
  }
  async function located(address: string, allScope: boolean | undefined) {
    return await locateControl(controls, await view(), address, allScope, UNKNOWN_CALLER)
  }
  return {
    create: (request: ThreadCreateInput) =>
      control(threadToolParamSchemas.thread_create, request, async (value) =>
        createThread(controls, await view(), value, {
          operationId: value.idempotency_key ?? `auto:${randomUUID()}`,
          callerId: UNKNOWN_CALLER,
          view,
          deliverPrompt: async (_current, target, send, key) => {
            // The script created the thread, so its first prompt carries the creator's authority (#14045), as the tool's does.
            const sent = await pipeline.deliver({
              sender: { kind: "cli", uid: options.uid, user: options.user },
              caller_id: principal,
              target,
              text: send.message,
              mode: send.delivery ?? DEFAULT_THREAD_DELIVERY,
              idempotency_key: key,
              args: send,
              authority: "creator",
            })
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
      control(threadToolParamSchemas.thread_interrupt, request, async (value) => {
        const found = await located(value.thread, value.all_scope)
        if (found.kind === "error") return found.result
        if (found.kind === "not_live") return NOT_LIVE
        return await interruptThread(found.control, value.turn_id)
      }),
    close: (request: ThreadCloseInput) =>
      control(threadToolParamSchemas.thread_close, request, async (value) => {
        const found = await located(value.thread ?? "self", value.all_scope)
        if (found.kind === "error") return found.result
        // Nothing live holds it: there is nothing to close, and the thread stays resumable from its session file.
        if (found.kind === "not_live") return notLiveAnswer("close", found)
        return await closeThread(found.control, closeOptions(value))
      }),
    rename: (request: ThreadRenameInput) =>
      control(threadToolParamSchemas.thread_rename, request, async (value) =>
        renameThread(controls, await view(), value, value.idempotency_key ?? `auto:${randomUUID()}`, UNKNOWN_CALLER),
      ),
    setModel: (request: ThreadSetModelInput) =>
      control(threadToolParamSchemas.thread_set_model, request, async (value) => {
        const found = await located(value.thread, value.all_scope)
        if (found.kind === "error") return found.result
        if (found.kind === "not_live") return NOT_LIVE
        return await setModelOn(found.control, value.model, value.provider)
      }),
  }
}
