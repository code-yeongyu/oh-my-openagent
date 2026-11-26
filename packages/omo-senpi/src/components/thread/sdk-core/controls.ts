import {
  parseThreadParams,
  threadToolParamSchemas,
  type ThreadCloseInput,
  type ThreadCreateInput,
  type ThreadInterruptInput,
  type ThreadRenameInput,
  type ThreadArchiveInput,
  type ThreadSetModelInput,
  type ThreadSetReasoningInput,
  type ThreadToolResult,
  type ThreadUnloadInput,
  ThreadUnloadParams,
} from "../contracts"
import { createThread } from "../control/create"
import { locateControl } from "../control/locate"
import {
  closeOptions,
  closeThread,
  interruptThread,
  NOT_LIVE,
  setModelOn,
  setThinkingLevelOn,
  unloadOptions,
  unloadThread,
} from "../control/operations"
import { controlWait, type ControlWait, waitRefusal } from "../control/control-wait"
import { controlIdentity } from "../control/port"
import { awaitPromptStart, FIRST_PROMPT_START_RESERVE_MS, FIRST_PROMPT_START_WAIT_MS } from "../control/prompt-start"
import { renameThread } from "../control/rename"
import { archiveThread } from "../tools/archive-ops"
import { sendToTarget } from "../sdk-send"
import { UNKNOWN_CALLER } from "../tools/ports"
import { callWait, type CallWaitOptions, waitWithinCallBudget } from "../../call-budget/call-deadline"
import { failureResult } from "../tools/internals"
import type { ThreadCoreContext } from "./context"
import type { Retrying } from "./keyed"

type ControlName =
  | "thread_create"
  | "thread_interrupt"
  | "thread_close"
  | "thread_rename"
  | "thread_set_model"
  | "thread_set_reasoning"
  | "thread_archive"
  | "thread_unload"

// Each control's parameter schema: the tool's, and the SDK's unload, which no tool takes.
const SCHEMAS = { ...threadToolParamSchemas, thread_unload: ThreadUnloadParams } as const

/**
 * The session controls of the agent tools (thread_create, thread_interrupt, thread_close, thread_rename,
 * thread_set_model): the same arguments, bodies and results, on this device or another of the account. The SDK acts as
 * itself, never as a session, so `self` is `caller_context_missing` and a created thread records no creator.
 */
export function createControls(context: ThreadCoreContext) {
  const { options, principal, store, pipeline, controls, view } = context
  // One session control as its tool runs it: the tool's parameter schema, the core's receipt book for its key
  // (sdk-core/keyed.ts), then its body; a control's typed refusal is data. The root call's wait options (slice T1b) bound
  // every port call of the body: a wait already lost answers before the receipt book admits anything, and the body runs
  // inside the deadline scope, so its remote commands are cut to what is left.
  function control<I>(
    name: ControlName,
    request: I,
    options: CallWaitOptions | undefined,
    body: (value: I, key: string, retrying: Retrying, wait: ControlWait) => Promise<ThreadToolResult>,
    /** Inputs the root passes beside the tool schema's own (create's prompt turn): its receipt is bound to them too. */
    beside?: Readonly<Record<string, unknown>>,
  ): Promise<ThreadToolResult> {
    return context.guard(async () => {
      const parsed = parseThreadParams(SCHEMAS[name], request)
      if (parsed.kind === "error") return parsed as ThreadToolResult
      const value = parsed.value as I & { readonly idempotency_key?: string }
      const wait = callWait(options, context.waitClock, context.late)
      const lost = wait.lost()
      if (lost !== undefined) return failureResult(waitRefusal(lost).failure)
      const waited = controlWait(wait)
      return await wait.scoped(() =>
        context.keyed(
          name,
          beside === undefined ? value : { ...value, ...beside },
          value.idempotency_key,
          (key, retrying) => body(value, key, retrying, waited),
        ),
      )
    })
  }
  async function located(address: string, allScope: boolean | undefined, wait: ControlWait) {
    return await locateControl(controls, await wait.read(view), address, allScope, UNKNOWN_CALLER, wait)
  }
  return {
    create: (request: ThreadCreateInput, first?: { readonly expected_turn_id?: string }) =>
      control(
        "thread_create",
        request,
        undefined,
        async (value, key, retrying) =>
          createThread(controls, await view(), value, {
            operationId: key,
            callerId: UNKNOWN_CALLER,
            retrying,
            view,
            ...(first?.expected_turn_id === undefined ? {} : { promptTurn: first.expected_turn_id }),
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
        first,
      ),
    interrupt: (request: ThreadInterruptInput, options?: CallWaitOptions) =>
      control("thread_interrupt", request, options, async (value, _key, _retrying, wait) => {
        const found = await located(value.thread, value.all_scope, wait)
        if (found.kind === "error") return found.result
        if (found.kind === "not_live") return NOT_LIVE
        return await interruptThread(found.control, value.turn_id)
      }),
    close: (request: ThreadCloseInput, options?: CallWaitOptions) =>
      control("thread_close", request, options, async (value, _key, _retrying, wait) => {
        const found = await located(value.thread ?? "self", value.all_scope, wait)
        if (found.kind === "error") return found.result
        // Nothing live holds it: there is nothing to close, and the thread stays resumable from its session file.
        if (found.kind === "not_live")
          return { kind: "ok", ...controlIdentity(found), closed: false, reason: "not_live", dropped_deliveries: [] }
        return await closeThread(found.control, closeOptions(value))
      }),
    rename: (request: ThreadRenameInput, options?: CallWaitOptions) =>
      control("thread_rename", request, options, async (value, key, _retrying, wait) =>
        renameThread(controls, await wait.read(view), value, key, UNKNOWN_CALLER, wait),
      ),
    setModel: (request: ThreadSetModelInput, options?: CallWaitOptions) =>
      control("thread_set_model", request, options, async (value, _key, _retrying, wait) => {
        const found = await located(value.thread, value.all_scope, wait)
        if (found.kind === "error") return found.result
        if (found.kind === "not_live") return NOT_LIVE
        return await setModelOn(found.control, value.model, value.provider)
      }),
    setReasoning: (request: ThreadSetReasoningInput, options?: CallWaitOptions) =>
      control("thread_set_reasoning", request, options, async (value, _key, _retrying, wait) => {
        const found = await located(value.thread, value.all_scope, wait)
        if (found.kind === "error") return found.result
        if (found.kind === "not_live") return NOT_LIVE
        return await setThinkingLevelOn(found.control, value.level, value.scope)
      }),
    unload: (request: ThreadUnloadInput, options?: CallWaitOptions) =>
      control("thread_unload", request, options, async (value, _key, _retrying, wait) => {
        const found = await located(value.thread, value.all_scope, wait)
        if (found.kind === "error") return found.result
        // Nothing live holds it: it is already out of every host and stays resumable from its session file.
        if (found.kind === "not_live")
          return {
            kind: "ok",
            ...controlIdentity(found),
            unloaded: false,
            dropped_deliveries: [],
            dropped_user_messages: [],
          }
        return await unloadThread(found.control, unloadOptions(value))
      }),
    archive: (request: ThreadArchiveInput, options?: CallWaitOptions) =>
      control("thread_archive", request, options, async (value, _key, _retrying, wait) =>
        archiveThread(controls, await wait.read(view), value, UNKNOWN_CALLER, wait),
      ),
  }
}
