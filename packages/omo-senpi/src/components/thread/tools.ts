import { TOOL_CALL_BUDGET_MS, waitWithinCallBudget, withCallDeadline } from "../call-budget/call-deadline"
import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"
import { gatewaySchemaRefusal } from "./errors"
import { type Static } from "typebox"
import {
  parseThreadParams,
  threadToolParamSchemas,
  type ThreadCloseInput,
  type ThreadCreateInput,
  type ThreadHandoffInput,
  type ThreadInterruptInput,
  type ThreadListInput,
  type ThreadReadInput,
  type ThreadRenameInput,
  type ThreadSendInput,
  type ThreadSetModelInput,
  type ThreadSetReasoningInput,
  type ThreadArchiveInput,
  type ThreadToolName,
  type ThreadToolResult,
} from "./contracts"
import { THREAD_FAMILY_PROMPT_GUIDELINES } from "./metadata"
import { withClosedRows } from "./remote/closed-rows"
import { threadLink } from "./thread-link"
export type { ThreadTranscriptEntry } from "./reader"
import { hashArgs } from "./gateway/hash-args"
import { GATEWAY_RECEIPT_RETENTION_MS } from "./gateway/constants"
import { isLockWaitExceeded } from "./gateway/lock-wait"
import { resolve } from "./address/lazy"
import { sendThread, sendToTarget, viewForSend } from "./sdk-send"
import type { DeliveryOutcome, DeliveryTarget } from "./gateway/transport"
import { createGatewayServices } from "./tools/gateway-services"
import { listThreads, readThread, withBacklog } from "./tools/read-ops"
import { archiveThread } from "./tools/archive-ops"
import { rowState, threadModel } from "./tools/thread-state"
import { threadToolPermission } from "./tools/local-permission"
import { withThreadRenderers } from "./tools/render"
import { threadSendPermission } from "./tools/reply-permission"
import { listAcross, readReceipt } from "./remote/lazy-ops"
import { rowCreatedAt, rowFolder } from "./remote/ports"
import { locateControl } from "./control/locate"
import { createThread } from "./control/create"
import { awaitPromptStart, FIRST_PROMPT_START_RESERVE_MS, FIRST_PROMPT_START_WAIT_MS } from "./control/prompt-start"
import {
  closeOptions,
  closeThread,
  interruptThread,
  NOT_LIVE,
  setModelOn,
  setThinkingLevelOn,
} from "./control/operations"
import { renameThread } from "./control/rename"
import { controlIdentity, controlRefusalOf } from "./control/port"
import { registerExtensionTools, type ExtensionToolHost } from "./tools/extension-tools"
import { createMonitorTargetResolver, installMonitorTargetResolution } from "./tools/monitor-target"
export type { ThreadHost, ThreadHostSession, ThreadToolSurfaceOptions } from "./tools/ports"
export { UNKNOWN_CALLER } from "./tools/ports"
import {
  UNKNOWN_CALLER,
  type ThreadHostView,
  type ThreadHostViewRequest,
  type ThreadToolSurfaceOptions,
} from "./tools/ports"
import {
  degradedSummary,
  failure,
  hostView,
  metadata,
  output,
  sendAddressBook,
  summary,
  targetSession,
  type AnyTool,
  type ToolOutput,
  uncertainFailure,
  uncertainNote,
} from "./tools/internals"
import { currentResult, threadRow } from "./tools/thread-row"

/** How many keys a tool surface keeps for recovering receipts whose admission reply was lost. */
export const RECEIPT_RECOVERY_MAX_KEYS = 4_096
export function createThreadTools(options: ThreadToolSurfaceOptions): readonly AnyTool[] {
  return buildThreadTools(options).tools
}

/** thread_send as `callerId` with no tool call behind it, through the same wrapper a tool call takes (#14430 operator alerts). */
export type ThreadSendAs = (callerId: string, args: ThreadSendInput) => Promise<ThreadToolResult>

function buildThreadTools(surface: ThreadToolSurfaceOptions): {
  readonly tools: readonly AnyTool[]
  readonly sendAs: ThreadSendAs
  readonly dispose: () => void
} {
  // One ledger of the threads these tools closed on other devices, read by every tool through the remote surface (#14170).
  const options = surface.remote === undefined ? surface : { ...surface, remote: withClosedRows(surface.remote) }
  const { store, pipeline } = createGatewayServices(options, () => view({ offline: true }))
  const now = options.now ?? store.now
  async function view(request?: ThreadHostViewRequest): Promise<ThreadHostView> {
    await options.ensureHost?.()
    return hostView(options, request)
  }
  // Receipts this process began but could not settle (the store gave up at its lock-wait bound):
  // the row stays `prepared` under this instance, which would answer `idempotency_in_progress`
  // forever. A retry of such a key is `idempotency_uncertain` with the note instead.
  const unsettled = new Map<string, string>()
  // Keys whose receipt admission failed without a reply: the store may still have committed the
  // prepared row (its worker exited after the commit), which this instance's retry would read as
  // `in_progress` forever. Nothing ran for such a call, so a retry that finds that row while no
  // invocation of this facade is running the key takes it up and runs the call. Each key is kept
  // until the receipt it may have left expires (admission time + the receipt retention), at most
  // `RECEIPT_RECOVERY_MAX_KEYS` at once: when full, a call under a new key is refused before its
  // admission, so no key that may still need recovering is ever dropped. Disposal clears them.
  const unanswered = new Map<string, number>()
  // Keys whose admission is awaiting the store, with how many calls await it: each may become a
  // recovery key, so it holds a slot from before its admission until the store answers (or the
  // failure leaves it in `unanswered`). Overlapping calls under one key share one slot.
  const admitting = new Map<string, number>()
  const heldSlots = (): number => {
    let held = unanswered.size
    for (const key of admitting.keys()) if (!unanswered.has(key)) held++
    return held
  }
  const recoverable = (key: string, at: number): boolean => {
    const until = unanswered.get(key)
    if (until !== undefined && until <= at) unanswered.delete(key)
    return unanswered.has(key)
  }
  const recoveryFull = (at: number): boolean => {
    if (heldSlots() < RECEIPT_RECOVERY_MAX_KEYS) return false
    for (const [key, until] of unanswered) if (until <= at) unanswered.delete(key)
    return heldSlots() >= RECEIPT_RECOVERY_MAX_KEYS
  }
  const releaseAdmitting = (key: string): void => {
    const calls = admitting.get(key) ?? 0
    if (calls <= 1) admitting.delete(key)
    else admitting.set(key, calls - 1)
  }
  const running = new Set<string>()
  const receiptKey = (scope: {
    readonly principal: string
    readonly operation: string
    readonly idempotency_key: string
  }) => `${scope.principal}\u0000${scope.operation}\u0000${scope.idempotency_key}`
  async function execute<T extends ThreadToolName>(
    name: T,
    callId: string,
    args: unknown,
    ectx: unknown,
    sideEffect: (
      view: ThreadHostView,
      value: Static<(typeof threadToolParamSchemas)[T]>,
      operationId: string,
      callerId: string,
      retrying: { readonly error_note: string | null } | undefined,
    ) => Promise<ThreadToolResult>,
  ): Promise<ToolOutput> {
    const callerId =
      (ectx as { sessionManager?: { getSessionId?: () => string } } | undefined)?.sessionManager?.getSessionId?.() ??
      options.callerSessionId()
    const parsed = parseThreadParams(threadToolParamSchemas[name], args)
    if (parsed.kind === "error") return output(parsed as ThreadToolResult)
    const value = parsed.value as Static<(typeof threadToolParamSchemas)[T]>
    if (
      name === "thread_read" &&
      "delivery_id" in value &&
      typeof value.delivery_id === "string" &&
      "thread" in value &&
      typeof value.thread === "string"
    ) {
      // This branch precedes view()/ensureHost and the read tool's own receipt admission.
      return output(await readReceipt(store, options.remote, callerId, value.thread, value.delivery_id, now()))
    }
    const explicitKey =
      "idempotency_key" in value ? (value as { idempotency_key?: string }).idempotency_key?.trim() : undefined
    const scope = {
      principal: `session:${callerId}`,
      operation: name,
      idempotency_key: explicitKey !== undefined && explicitKey.length > 0 ? explicitKey : `call:${callId}`,
    }
    // A send owns its idempotency: the gateway engine's receipt is written in the delivery's own
    // transaction and answers a lost ACK with `idempotency_uncertain` + the row state.
    const receipted = !(name === "thread_send" || name === "thread_handoff")
    // An earlier run under this key failed after it may have acted: only thread_create may run again, and it decides (#14060).
    let retrying: { readonly error_note: string | null } | undefined
    if (receipted) {
      // Nothing has run yet, so a store that cannot admit the receipt fails the call as data: the store
      // lock held past its wait bound is `overloaded`, any other store failure `internal_error`.
      const key = receiptKey(scope)
      const at = now()
      // The slot is taken before the admission is awaited, so overlapping calls cannot all pass the check.
      if (!recoverable(key, at) && !admitting.has(key) && recoveryFull(at)) {
        return output(
          failure(
            "overloaded",
            `${RECEIPT_RECOVERY_MAX_KEYS} earlier calls on this surface failed before the gateway store answered and may still need recovering; nothing ran.`,
            "Retry those calls under their own idempotency keys, then retry this one.",
            { budget: "receipt_recovery", max_keys: RECEIPT_RECOVERY_MAX_KEYS },
          ),
        )
      }
      let admission: Awaited<ReturnType<typeof store.toolReceiptBegin>>
      admitting.set(key, (admitting.get(key) ?? 0) + 1)
      try {
        admission = await store.toolReceiptBegin({
          ...scope,
          now: at,
          args_hash: hashArgs(value),
          retry_uncertain: name === "thread_create",
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (isLockWaitExceeded(error))
          return output(
            failure(
              "overloaded",
              `The gateway store is locked by another process; nothing ran: ${message}`,
              "Wait a few seconds, then retry the call.",
            ),
          )
        const schema = gatewaySchemaRefusal(error)
        if (schema !== undefined) return output({ kind: "error", error: schema })
        unanswered.set(key, at + GATEWAY_RECEIPT_RETENTION_MS)
        return output(
          failure(
            "internal_error",
            `The gateway store could not record the call; nothing ran: ${message}`,
            "Retry the call; if it keeps failing, check the gateway store.",
          ),
        )
      } finally {
        // The slot passes to the key's recovery entry when the failure left one; otherwise it is free again.
        releaseAdmitting(key)
      }
      // The store committed this key's reservation for a call whose reply was lost, so nothing ran under it: the call
      // resumes as the reservation it found, a recovery keeping its first cause (#14623 review round 2 H1).
      if (admission.kind === "in_progress" && recoverable(key, at) && !running.has(key) && !unsettled.has(key))
        admission =
          admission.recovery === undefined
            ? { kind: "accepted" }
            : { kind: "retry", error_note: admission.recovery.error_note }
      unanswered.delete(key)
      if (admission.kind === "replay") {
        const result = currentResult(admission.result as ThreadToolResult)
        return output(name === "thread_create" && result.kind === "ok" ? { ...result, deduplicated: true } : result)
      }
      if (admission.kind === "conflict")
        return output(
          failure(
            "idempotency_conflict",
            "The idempotency key was already used with different arguments.",
            "Retry with a new idempotency_key.",
          ),
        )
      if (admission.kind === "in_progress") {
        const note = unsettled.get(receiptKey(scope))
        if (note !== undefined)
          return output(
            failure(
              "idempotency_uncertain",
              "The earlier operation may have been delivered.",
              "Read the target transcript before deciding whether to retry.",
              { error_note: note },
            ),
          )
        return output(
          failure(
            "idempotency_in_progress",
            "The same operation is already in progress.",
            "Wait for the earlier call to settle, then retry.",
          ),
        )
      }
      // #14060: a thread_create that failed after the host made its thread may recover by re-running it; the create
      // itself refuses unless it finds that thread (see thread_create). The store reserved the receipt for this retry
      // alone (#14623 H1), so its answer settles it like a new call's.
      if (admission.kind === "uncertain") return output(uncertainFailure(admission.error_note))
      if (admission.kind === "retry") retrying = { error_note: admission.error_note }
    }
    const unrecorded = (what: string) => (settleError: unknown) => {
      unsettled.set(
        receiptKey(scope),
        `${what}, and its receipt could not be recorded: ${settleError instanceof Error ? settleError.message : String(settleError)}`,
      )
    }
    const failed = async (error: unknown): Promise<ToolOutput> => {
      const message = error instanceof Error ? error.message : String(error)
      if (receipted)
        await store
          .toolReceiptSettle({ ...scope, now: now(), error_note: message })
          .catch(unrecorded(`the call failed (${message})`))
      running.delete(receiptKey(scope))
      const schema = gatewaySchemaRefusal(error)
      if (schema !== undefined) return output({ kind: "error", error: schema })
      if (message.startsWith("host_unavailable:")) {
        return output(
          failure(
            "host_unavailable",
            `The thread host is unavailable at ${message.slice("host_unavailable:".length)}.`,
            "Retry when the shared Senpi host is running.",
          ),
        )
      }
      if (message.startsWith("unsupported:")) {
        return output(
          failure(
            "unsupported",
            `The target's endpoint does not accept ${message.slice("unsupported:".length)}: that terminal runs an engine from before terminal session controls.`,
            "Update omo where that terminal runs and restart it, or use thread_send and thread_read (tool.thread_send() and tool.thread_read() in an eval cell); thread_list (tool.thread_list() in an eval cell) shows each thread's controls.",
            { command: message.slice("unsupported:".length) },
          ),
        )
      }
      return output(
        failure(
          "internal_error",
          `Thread operation failed: ${message}`,
          "Call thread_list (tool.thread_list() in an eval cell) and retry after checking the target.",
        ),
      )
    }
    let result: ThreadToolResult
    if (receipted) running.add(receiptKey(scope))
    try {
      // A send takes nothing live as the offline case: its view never raises host_unavailable.
      // A reply whose sender is on another device resolves there alone (A4.3.1), so it takes no local listing.
      const sendTo = name === "thread_send" && "thread" in value && typeof value.thread === "string" ? value.thread : ""
      // omo#14130: the call's one budget (call-deadline.ts) starts before its view, so the view's reads count against it.
      result = await withCallDeadline(Date.now() + TOOL_CALL_BUDGET_MS, async () => {
        const current =
          sendTo !== ""
            ? await viewForSend(options, sendTo, () => view({ offline: true }))
            : await view(receipted ? undefined : { offline: true })
        return await sideEffect(current, value, scope.idempotency_key, callerId, retrying)
      })
    } catch (error) {
      // A control's typed refusal is the call's answer, recorded like one: a retry under the same key replays it.
      const refusal = controlRefusalOf(error)
      if (refusal === undefined) return await failed(error)
      result = { kind: "error", error: refusal }
    }
    // A create that may have made its thread (its open's reply was lost) has no answer yet: its receipt stays uncertain,
    // so a retry under the key runs the create again, which finds that thread or answers uncertain again (#14060). The
    // note keeps the first uncertain answer's cause (#14569); a retry that fails in any way has not settled what the
    // first run made, so its receipt stays uncertain under that same note and its error is never replayed as final.
    const undecided =
      name === "thread_create" &&
      result.kind === "error" &&
      (result.error.code === "idempotency_uncertain" || retrying !== undefined)
        ? (retrying?.error_note ?? uncertainNote(result.error))
        : undefined
    if (receipted)
      await store
        .toolReceiptSettle({
          ...scope,
          now: now(),
          ...(undecided === undefined ? { result } : { error_note: undecided }),
        })
        .then((settled) => {
          if (!settled) unrecorded("the call ran")(new Error("this call no longer held its receipt"))
        }, unrecorded("the call ran"))
    running.delete(receiptKey(scope))
    return output(result)
  }

  /**
   * One body for a new, an existing or a forked thread, here or on another device (#12884): the shape checks, then
   * placement (the only step that reads the device), then the name checked against the threads the target device
   * sees, then one open through the SessionHost - a created or forked session starting in its creator's approval mode
   * on either device - then the creator record and the alias. An existing thread that is live already is answered
   * from placement (`deduplicated`), so no second open reaches it anywhere.
   */
  const create: AnyTool = {
    ...metadata("thread_create"),
    parameters: threadToolParamSchemas.thread_create,
    promptGuidelines: [THREAD_FAMILY_PROMPT_GUIDELINES],
    execute: (id: string, args: ThreadCreateInput, _signal, _onUpdate, ectx) =>
      execute("thread_create", id, args, ectx, async (current, value, operationId, callerId, retrying) =>
        createThread(options, current, value, {
          operationId,
          callerId,
          retrying,
          view: () => view(),
          deliverPrompt: async (prompted, target, send, key) =>
            renderSend(
              options,
              prompted,
              target,
              await sendToTarget(
                options,
                pipeline,
                target,
                send,
                key,
                { kind: "session", id: callerId },
                send,
                "creator",
              ),
            ),
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
  }
  const list: AnyTool = {
    ...metadata("thread_list"),
    parameters: threadToolParamSchemas.thread_list,
    execute: (id: string, args: ThreadListInput, _signal, _onUpdate, ectx) =>
      execute(
        "thread_list",
        id,
        args,
        ectx,
        async (current, value) =>
          await listAcross(
            options.remote,
            await withBacklog(options.store, listThreads(options, current, value.all_scope, value.state)),
            value.all_scope === true,
            value.state,
          ),
      ),
  }
  const read: AnyTool = {
    ...metadata("thread_read"),
    parameters: threadToolParamSchemas.thread_read,
    execute: (id: string, args: ThreadReadInput, signal, _onUpdate, ectx) =>
      execute("thread_read", id, args, ectx, async (current, value, _operationId, callerId) =>
        readThread(options, current, value, callerId, signal),
      ),
  }
  const send: AnyTool = {
    ...metadata("thread_send"),
    permissionParser: threadSendPermission(options),
    parameters: threadToolParamSchemas.thread_send,
    execute: (id: string, args: ThreadSendInput, _signal, _onUpdate, ectx) =>
      execute("thread_send", id, args, ectx, async (current, value, operationId, callerId) =>
        deliver(current, value, operationId, callerId),
      ),
  }
  const sendAs: ThreadSendAs = async (callerId, args) => {
    const sent = await execute(
      "thread_send",
      `send-as:${args.idempotency_key ?? callerId}`,
      args,
      { sessionManager: { getSessionId: () => callerId } },
      async (current, value, operationId, id) => deliver(current, value, operationId, id),
    )
    return sent.details.result
  }
  const interrupt: AnyTool = {
    ...metadata("thread_interrupt"),
    parameters: threadToolParamSchemas.thread_interrupt,
    execute: (id: string, args: ThreadInterruptInput, _signal, _onUpdate, ectx) =>
      execute("thread_interrupt", id, args, ectx, async (current, value, _operationId, callerId) => {
        const located = await locateControl(options, current, value.thread, value.all_scope, callerId)
        if (located.kind === "error") return located.result
        if (located.kind === "not_live") return NOT_LIVE
        return await interruptThread(located.control, value.turn_id)
      }),
  }
  const close: AnyTool = {
    ...metadata("thread_close"),
    parameters: threadToolParamSchemas.thread_close,
    execute: (id: string, args: ThreadCloseInput, _signal, _onUpdate, ectx) =>
      execute("thread_close", id, args, ectx, async (current, value, _operationId, callerId) => {
        const located = await locateControl(options, current, value.thread ?? "self", value.all_scope, callerId)
        if (located.kind === "error") return located.result
        // Nothing live holds it: there is nothing to close, and the thread stays resumable from its session file.
        if (located.kind === "not_live")
          return { kind: "ok", ...controlIdentity(located), closed: false, reason: "not_live", dropped_deliveries: [] }
        return await closeThread(located.control, closeOptions(value))
      }),
  }
  const handoff: AnyTool = {
    ...metadata("thread_handoff"),
    parameters: threadToolParamSchemas.thread_handoff,
    execute: (id: string, args: ThreadHandoffInput, _signal, _onUpdate, ectx) =>
      execute("thread_handoff", id, args, ectx, async (current, value, operationId, callerId) =>
        deliver(current, value, operationId, callerId, value.match === "fuzzy" ? "fuzzy" : "exact_name"),
      ),
  }
  const rename: AnyTool = {
    ...metadata("thread_rename"),
    parameters: threadToolParamSchemas.thread_rename,
    execute: (id: string, args: ThreadRenameInput, _signal, _onUpdate, ectx) =>
      execute("thread_rename", id, args, ectx, async (current, value, operationId, callerId) =>
        renameThread(options, current, value, operationId, callerId),
      ),
  }
  const setModel: AnyTool = {
    ...metadata("thread_set_model"),
    parameters: threadToolParamSchemas.thread_set_model,
    execute: (id: string, args: ThreadSetModelInput, _signal, _onUpdate, ectx) =>
      execute("thread_set_model", id, args, ectx, async (current, value, _operationId, callerId) => {
        const located = await locateControl(options, current, value.thread, value.all_scope, callerId)
        if (located.kind === "error") return located.result
        if (located.kind === "not_live") return NOT_LIVE
        return await setModelOn(located.control, value.model, value.provider)
      }),
  }
  const setReasoning: AnyTool = {
    ...metadata("thread_set_reasoning"),
    parameters: threadToolParamSchemas.thread_set_reasoning,
    execute: (id: string, args: ThreadSetReasoningInput, _signal, _onUpdate, ectx) =>
      execute("thread_set_reasoning", id, args, ectx, async (current, value, _operationId, callerId) => {
        const located = await locateControl(options, current, value.thread, value.all_scope, callerId)
        if (located.kind === "error") return located.result
        if (located.kind === "not_live") return NOT_LIVE
        return await setThinkingLevelOn(located.control, value.level, value.scope)
      }),
  }
  const archive: AnyTool = {
    ...metadata("thread_archive"),
    parameters: threadToolParamSchemas.thread_archive,
    execute: (id: string, args: ThreadArchiveInput, _signal, _onUpdate, ectx) =>
      execute("thread_archive", id, args, ectx, async (current, value, _operationId, callerId) =>
        archiveThread(options, current, value, callerId),
      ),
  }
  const dispose = () => {
    pipeline.dispose()
    unanswered.clear()
  }
  return {
    tools: [create, list, read, send, interrupt, close, handoff, rename, setModel, setReasoning, archive].map((tool) =>
      withThreadRenderers({
        ...tool,
        permissionParser: tool.permissionParser ?? threadToolPermission(tool.name, options),
      }),
    ),
    sendAs,
    dispose,
  }

  async function deliver(
    current: ThreadHostView,
    value: ThreadSendInput | ThreadHandoffInput,
    idempotencyKey: string,
    callerId: string,
    resolvedBy?: "exact_name" | "fuzzy",
  ): Promise<ThreadToolResult> {
    const routed = await sendThread(
      options,
      pipeline,
      resolve,
      current,
      value,
      idempotencyKey,
      { kind: "session", id: callerId },
      value,
      resolvedBy === "fuzzy" ? "fuzzy" : "exact",
    )
    return routed.kind === "error" ? routed : renderSend(options, current, routed.target, routed.sent, resolvedBy)
  }
}

/** Render delivery facts in the tool contract, including links and handoff target details. */
function renderSend(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  target: DeliveryTarget,
  sent: DeliveryOutcome,
  resolvedBy?: "exact_name" | "fuzzy",
): ThreadToolResult {
  if (sent.kind === "error") return { kind: "error", error: sent.error }
  if ("device" in sent) {
    // The relay leg answers with the same delivery facts as the local one (#13014, #13036); it knows no endpoint on that device.
    const facts = {
      ...(sent.outcome === undefined ? {} : { outcome: sent.outcome }),
      ...(sent.delivery_id === undefined ? {} : { delivery_id: sent.delivery_id }),
      ...(sent.effective_mode === undefined ? {} : { effective_mode: sent.effective_mode }),
      device: sent.device,
    }
    const row = target.kind === "remote" ? target.row : undefined
    // #13304: another device's title and project are printed escaped.
    const title = row === undefined ? undefined : escapeForDisplay(row.title)
    if (resolvedBy === undefined || row === undefined)
      return {
        kind: "ok",
        thread: sent.thread_id,
        link: threadLink(sent.thread_id, title),
        delivery: sent.delivery,
        deduplicated: sent.deduplicated,
        ...facts,
      }
    const seen = new Date(row.updated_ms).toISOString()
    return {
      kind: "ok",
      ...threadRow({
        thread_id: sent.thread_id,
        name: escapeForDisplay(row.title),
        status: "live",
        state: rowState(row),
        ...threadModel(row.model),
        cwd: escapeForDisplay(rowFolder(row)),
        created_at: rowCreatedAt(row),
        updated_at: seen,
        device: row.device,
        link: threadLink(sent.thread_id, escapeForDisplay(row.title)),
      }),
      resolved_by: resolvedBy,
      delivery: sent.delivery,
      deduplicated: sent.deduplicated,
      ...facts,
    } as ThreadToolResult
  }
  const threadId = sent.thread_id
  const facts = {
    ...(sent.outcome === undefined ? {} : { outcome: sent.outcome }),
    delivery_id: sent.delivery_id,
    effective_mode: sent.effective_mode,
    ...(sent.collapsed === true ? { collapsed: true as const } : {}),
  }
  if (resolvedBy === undefined) {
    const title = current.sessions.find((session) => (session.durableSessionId ?? session.sessionId) === threadId)?.name
    return {
      kind: "ok",
      thread: threadId,
      link: threadLink(threadId, title),
      delivery: sent.delivery,
      message_seq: sent.message_seq,
      deduplicated: sent.deduplicated,
      ...facts,
    }
  }
  const session = targetSession(current, threadId)
  const entry = sendAddressBook(options, current, threadId, true).find((candidate) => candidate.thread_id === threadId)
  const thread =
    session !== undefined ? summary(session, entry) : entry !== undefined ? degradedSummary(entry) : undefined
  if (thread === undefined)
    return failure(
      "not_found",
      `Thread ${threadId} is not in the address book.`,
      "Call thread_list (tool.thread_list() in an eval cell) and retry.",
    )
  return {
    kind: "ok",
    ...threadRow(thread),
    resolved_by: resolvedBy,
    delivery: sent.delivery,
    message_seq: sent.message_seq,
    deduplicated: sent.deduplicated,
    ...facts,
  }
}

/**
 * Registers the eleven tools, and with `pi.on` the store extensions' session tools at each `session_start`
 * (`tools/extension-tools.ts`); `dispose` (shutdown) drops the receipt-recovery keys.
 */
export function registerThreadTools(
  pi: ExtensionToolHost,
  options: ThreadToolSurfaceOptions,
  log: (line: string) => void = () => undefined,
): { readonly sendAs: ThreadSendAs; readonly dispose: () => void } {
  const built = buildThreadTools(options)
  // Thread tools run on the loop side of a split session (engine `ToolDefinition.runs`).
  for (const tool of built.tools) pi.registerTool({ ...tool, runs: "brain" })
  if (pi.on !== undefined) {
    const host = pi as ExtensionToolHost & Required<Pick<ExtensionToolHost, "on">>
    registerExtensionTools(host, options, log)
    installMonitorTargetResolution(host, createMonitorTargetResolver(options), options.callerSessionId)
  }
  return { sendAs: built.sendAs, dispose: built.dispose }
}
