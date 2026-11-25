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
import { sentThreadLink } from "./tools/send-link"
export type { ThreadTranscriptEntry } from "./reader"
import { resolveAddress } from "./address/lazy"
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
} from "./tools/internals"
import { threadRow } from "./tools/thread-row"
import { createReceipts } from "./control/receipts"
import { thrown, type ThrownWording } from "./sdk-core/failures"

export { RECEIPT_RECOVERY_MAX_KEYS } from "./control/receipts"

/** The thread tools' wording of the one thrown-failure mapping (sdk-core/failures.ts `thrown`). */
const TOOL_WORDING: ThrownWording = {
  hostUnavailable: "Retry when the shared Senpi host is running.",
  unsupported: (command) =>
    `The target's endpoint does not accept ${command}: that terminal runs an engine from before terminal session controls.`,
  unsupportedNext:
    "Update omo where that terminal runs and restart it, or use thread_send and thread_read (tool.thread_send() and tool.thread_read() in an eval cell); thread_list (tool.thread_list() in an eval cell) shows each thread's controls.",
  unexpectedNext: "Call thread_list (tool.thread_list() in an eval cell) and retry after checking the target.",
}
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
  const receipts = createReceipts(store, now, options.onUnexpected)
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
    // An earlier run under this key failed after it may have acted: only a call that decides it itself runs again (#14060).
    let retrying: { readonly error_note: string | null } | undefined
    if (receipted) {
      const admission = await receipts.admit(scope, value)
      if (admission.kind === "answer") return output(admission.result)
      retrying = admission.retrying
    }
    const failed = async (error: unknown): Promise<ToolOutput> => {
      if (receipted) await receipts.fail(scope, error)
      return output(thrown(error, options.onUnexpected, TOOL_WORDING))
    }
    let result: ThreadToolResult
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
    if (receipted) await receipts.settle(scope, result, retrying)
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
    receipts.dispose()
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
      resolveAddress,
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
    if (resolvedBy === undefined || row === undefined)
      return {
        kind: "ok",
        thread: sent.thread_id,
        link: sentThreadLink(sent.thread_id, undefined, target),
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
    return {
      kind: "ok",
      thread: threadId,
      link: sentThreadLink(threadId, current, target),
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
