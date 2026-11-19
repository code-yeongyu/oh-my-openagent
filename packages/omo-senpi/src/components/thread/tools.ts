import { TOOL_CALL_BUDGET_MS, withCallDeadline } from "../call-budget/call-deadline"
import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"
import { gatewaySchemaRefusal, threadToolFailure } from "./errors"
import type { ThreadToolFailure } from "./errors"
import { type Static } from "typebox"
import { toThreadAddressEntries } from "./address-book"
import { type ThreadAddressEntry, type ThreadResolveResult } from "./addressing"
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
import { relayAddressBook, type RelayAddressBook } from "./remote/address-book"
import { withClosedRows } from "./remote/closed-rows"
import { threadLink } from "./thread-link"
export type { ThreadTranscriptEntry } from "./reader"
import { hashArgs } from "./gateway/bindings"
import { GATEWAY_RECEIPT_RETENTION_MS } from "./gateway/constants"
import { isLockWaitExceeded } from "./gateway/lock-wait"
import type { DeliveryPipeline } from "./gateway/pipeline"
import type { DeliveryTarget } from "./gateway/transport"
import type { DeliveryAuthority } from "./gateway/types"
import { createGatewayServices } from "./tools/gateway-services"
import { listThreads, readThread } from "./tools/read-ops"
import { archiveThread } from "./tools/archive-ops"
import { rowState, threadModel } from "./tools/thread-state"
import { createRelayTools } from "./tools/relay-tools"
import { threadToolPermission } from "./tools/local-permission"
import { withThreadRenderers } from "./tools/render"
import { consumedSendersOf, threadSendPermission } from "./tools/reply-permission"
import { otherDevice, replyTargetFailure, replyTargetMismatch } from "./tools/reply-target"
import { accountDevices } from "./remote/account"
import { listAcross } from "./remote/lazy-ops"
import { locateControl } from "./control/locate"
import { createThread } from "./control/create"
import { closeThread, interruptThread, NOT_LIVE, setModelOn, setThinkingLevelOn } from "./control/operations"
import { renameThread } from "./control/rename"
import { controlIdentity, controlRefusalOf } from "./control/port"
import { registerExtensionTools, type ExtensionToolHost } from "./tools/extension-tools"
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
  resolution,
  resolveEntries,
  sendAddressBook,
  summary,
  targetSession,
  type AnyTool,
  type ToolOutput,
  replyOnDevice,
  resolveAcross,
  uncertainFailure,
} from "./tools/internals"
import { currentResult, threadRow } from "./tools/thread-row"

/** How many keys a tool surface keeps for recovering receipts whose admission reply was lost. */
export const RECEIPT_RECOVERY_MAX_KEYS = 4_096
/** A registered exact id needs no pre-engine view; the engine validates its one endpoint. */
const PUBLISHED_SEND_VIEW: ThreadHostView = { sessions: [], hosts: [], disk: [] }
/** A reply to a sender on another device resolves on that device alone and reads no view of this one. */
const NO_LOCAL_VIEW: ThreadHostView = { sessions: [], hosts: [], disk: [] }

/**
 * This device's id as one send already read it, keyed by the view that send took (#13483 review L1): the choice of view
 * and the route in `locate` rest on the same read, so a read that fails and then succeeds cannot pick an empty view and
 * then route a local reply into it.
 */
const DEVICE_READ = new WeakMap<ThreadHostView, string | undefined | ThreadToolFailure>()

export function createThreadTools(options: ThreadToolSurfaceOptions): readonly AnyTool[] {
  return buildThreadTools(options).tools
}

function buildThreadTools(surface: ThreadToolSurfaceOptions): {
  readonly tools: readonly AnyTool[]
  readonly dispose: () => void
} {
  // One ledger of the threads these tools closed on other devices, read by every tool through the remote surface (#14170).
  const options = surface.remote === undefined ? surface : { ...surface, remote: withClosedRows(surface.remote) }
  const { store, relay, pipeline } = createGatewayServices(options, () => view({ offline: true }))
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
        admission = await store.toolReceiptBegin({ ...scope, now: at, args_hash: hashArgs(value) })
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
      if (admission.kind === "in_progress" && recoverable(key, at) && !running.has(key) && !unsettled.has(key))
        admission = { kind: "accepted" }
      unanswered.delete(key)
      if (admission.kind === "replay") return output(currentResult(admission.result as ThreadToolResult))
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
      // itself refuses unless it finds that thread (see thread_create).
      if (admission.kind === "uncertain") {
        if (name !== "thread_create") return output(uncertainFailure(admission.error_note))
        retrying = { error_note: admission.error_note }
      }
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
        let current: ThreadHostView
        if (sendTo !== "" && sendTo !== "self" && (await store.sessionOwner(sendTo)) !== null)
          current = PUBLISHED_SEND_VIEW
        else {
          const route = sendTo === "" ? undefined : await replyRoute(options, sendTo)
          current =
            route?.leaves === true ? { ...NO_LOCAL_VIEW } : await view(receipted ? undefined : { offline: true })
          if (route?.read === true) DEVICE_READ.set(current, route.here)
        }
        return await sideEffect(current, value, scope.idempotency_key, callerId, retrying)
      })
    } catch (error) {
      // A control's typed refusal is the call's answer, recorded like one: a retry under the same key replays it.
      const refusal = controlRefusalOf(error)
      if (refusal === undefined) return await failed(error)
      result = { kind: "error", error: refusal }
    }
    if (receipted) await store.toolReceiptSettle({ ...scope, now: now(), result }).catch(unrecorded("the call ran"))
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
          deliverPrompt: (prompted, target, send, key) =>
            deliverThrough(options, pipeline, prompted, target, send, key, callerId, undefined, "creator"),
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
            listThreads(options, current, value.all_scope, value.state),
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
        deliver(current, value.thread, value, operationId, callerId),
      ),
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
        return await closeThread(located.control, value.force)
      }),
  }
  const handoff: AnyTool = {
    ...metadata("thread_handoff"),
    parameters: threadToolParamSchemas.thread_handoff,
    execute: (id: string, args: ThreadHandoffInput, _signal, _onUpdate, ectx) =>
      execute("thread_handoff", id, args, ectx, async (current, value, operationId, callerId) =>
        deliver(current, value.thread, value, operationId, callerId, value.match === "fuzzy" ? "fuzzy" : "exact_name"),
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
  const relayTools = createRelayTools({ options, relay, failure })
  const dispose = () => {
    pipeline.dispose()
    unanswered.clear()
    relay.dispose()
  }
  return {
    tools: [
      create,
      list,
      read,
      send,
      interrupt,
      close,
      handoff,
      rename,
      setModel,
      setReasoning,
      archive,
      ...relayTools,
    ].map((tool) =>
      withThreadRenderers({
        ...tool,
        permissionParser: tool.permissionParser ?? threadToolPermission(tool.name, options),
      }),
    ),
    dispose,
  }

  /**
   * Where a send's address points: a session on another device (its account listing row), or a session this device
   * holds, resolved through the send address book under the scope the address resolved with. A registered exact id
   * (`PUBLISHED_SEND_VIEW`) skips the address book; the engine validates its one endpoint.
   */
  async function locate(
    current: ThreadHostView,
    address: string,
    allScope: boolean | undefined,
    callerId: string,
    match: "exact" | "fuzzy" = "exact",
  ): Promise<DeliveryTarget | { readonly kind: "error"; readonly result: ThreadToolResult }> {
    const scope = allScope
    const refuse = (error: ThreadToolFailure) => ({
      kind: "error" as const,
      result: { kind: "error", error } as ThreadToolResult,
    })
    // Amendment A4.3.1 of #13037: a send approved as a reply resolves on the device the consumed delivery came from, before
    // this device's own entries and before any other listing match, whether the sender is named by id or by stated name.
    const senders = match === "exact" ? consumedSendersOf(options, address) : []
    const here =
      match === "exact" && DEVICE_READ.has(current) ? DEVICE_READ.get(current) : await thisDeviceOf(options, senders)
    if (typeof here === "object") return refuse(here)
    const replyTo = replySender(address, senders, here)
    if (replyTo !== undefined && "code" in replyTo) return refuse(replyTo)
    if (replyTo?.device !== undefined) {
      const resolved = await replyOnDevice(options, { session_id: replyTo.session_id, device: replyTo.device })
      if (resolved.kind === "error")
        return { kind: "error", result: { kind: "error", error: resolved } as ThreadToolResult }
      const mismatch = replyTargetMismatch(options, address, resolved.entry, here)
      if (mismatch !== undefined) return refuse(mismatch)
      if (resolved.entry.transport?.kind === "relay") return { kind: "remote", row: resolved.entry.transport.row }
    }
    if (current === PUBLISHED_SEND_VIEW) {
      // A reply approved by the sender's stated name must still land on that sender, not on a published thread that happens to carry the same spelling as its id.
      const mismatch = replyTargetMismatch(
        options,
        address,
        {
          thread_id: address,
          name: address,
          status: "live",
          cwd: "",
          created_at: "",
          updated_at: null,
        },
        here,
      )
      if (mismatch !== undefined)
        return { kind: "error", result: { kind: "error", error: mismatch } as ThreadToolResult }
      return { kind: "local", thread_id: address, all_scope: scope }
    }
    // Decision 0027: ONE resolver over this device's book and the relay transport's book (the account's other devices);
    // the entry it returns says which transport carries the send. An unreachable relay leaves the local book alone.
    const entries =
      match === "fuzzy"
        ? resolveEntries(options, current)
        : toThreadAddressEntries(sendAddressBook(options, current, address, true))
    // A reply to a sender on this device resolves among this device's entries only (A4.3.1), and only by the sender's
    // exact id or stated name: an id prefix never turns an approved reply into a send to another thread. A send never
    // targets its own caller, so an id prefix is resolved without it (UUIDv7 ids share 8 hex characters for ~65 s).
    let resolved: ThreadResolveResult & { readonly all_scope?: boolean | undefined } =
      replyTo === undefined
        ? await resolveAcross(options, entries, address, callerId, scope, match, true, { exclude: callerId })
        : resolution(options, entries, address, callerId, scope, false)
    // #14048: a delivery id without a device part (`rpc:local/<id>`, a bare row id) proves no device: another device's
    // delivery arrives that way when the connection that admitted it declared no remote origin. A sender this device does
    // not hold is then looked up account-wide (exact id or name only, never an id prefix), and the reply goes only to the
    // session its durable id names, on the one device that lists it: with no device to pin, a copy of that id on a second
    // device makes the sender ambiguous.
    if (replyTo !== undefined && resolved.kind === "error" && resolved.code === "not_found") {
      resolved = await resolveAcross(options, entries, address, callerId, scope, match, true, false)
      if (resolved.kind === "ok" && resolved.entry.transport?.kind === "relay") {
        if (resolved.entry.thread_id !== replyTo.session_id) return refuse(replyTargetFailure(address, resolved.entry))
        const ambiguous = await unattestedSenderAmbiguity(options, entries, replyTo.session_id)
        if (ambiguous !== undefined) return refuse(ambiguous)
        return { kind: "remote", row: resolved.entry.transport.row }
      }
    }
    if (resolved.kind === "error")
      return { kind: "error", result: { kind: "error", error: resolved } as ThreadToolResult }
    // The allowance approved this send as a reply to a consumed delivery's sender (by id or stated name): deliver only when
    // the address resolves to that sender on that sender's device, else refuse by name without sending (decision 0027
    // section 6, A4.3.1).
    const mismatch = replyTargetMismatch(options, address, resolved.entry, here)
    if (mismatch !== undefined) return { kind: "error", result: { kind: "error", error: mismatch } as ThreadToolResult }
    if (resolved.entry.transport?.kind === "relay") return { kind: "remote", row: resolved.entry.transport.row }
    return { kind: "local", thread_id: resolved.entry.thread_id, all_scope: resolved.all_scope ?? scope }
  }

  async function deliver(
    current: ThreadHostView,
    address: string,
    value: ThreadSendInput | ThreadHandoffInput,
    idempotencyKey: string,
    callerId: string,
    resolvedBy?: "exact_name" | "fuzzy",
  ): Promise<ThreadToolResult> {
    const target = await locate(current, address, value.all_scope, callerId, resolvedBy === "fuzzy" ? "fuzzy" : "exact")
    if (target.kind === "error") return target.result
    return await deliverThrough(options, pipeline, current, target, value, idempotencyKey, callerId, resolvedBy)
  }
}

/**
 * The one send: the resolved target, the caller as the gateway names it (`session:<durable id>`, its name, turn and
 * cause), the text and mode go through the delivery pipeline, whose transport the target's kind picks. Both transports
 * answer the same result (#13006): the delivery outcome, its `delivery_id` and the lane it took (`effective_mode`) are
 * reported the same way whatever carried it; a gateway row's `message_seq` exists only for a session
 * this device holds (an unreachable one is `queued_offline`, the row is durable), and `device` only names another one.
 * A chain may come back to a session it passed; only a session sending to itself is refused `loop_detected`. Answers
 * may also travel through thread_read, thread_report and thread_answer.
 */
async function deliverThrough(
  options: ThreadToolSurfaceOptions,
  pipeline: DeliveryPipeline,
  current: ThreadHostView,
  target: DeliveryTarget,
  value: ThreadSendInput | ThreadHandoffInput,
  idempotencyKey: string,
  callerId: string,
  resolvedBy: "exact_name" | "fuzzy" | undefined,
  authority?: DeliveryAuthority,
): Promise<ThreadToolResult> {
  if (callerId === UNKNOWN_CALLER)
    return failure(
      "caller_context_missing",
      "A gateway send needs the calling session's durable id.",
      "Retry from a session that passes its execution context.",
    )
  const turn = options.callerTurnId?.()
  const cause = options.callerCause?.()
  const name = options.callerName?.()?.trim()
  const inboundHop = options.callerChainHop?.()
  const sent = await pipeline.deliver({
    sender: {
      kind: "session",
      durable_id: callerId,
      ...(name === undefined || name === "" ? {} : { name }),
      ...(turn === undefined ? {} : { turn_id: turn }),
      ...(cause === undefined ? {} : { cause_delivery_id: cause }),
    },
    caller_id: callerId,
    target,
    text: value.message,
    mode: value.delivery ?? "auto",
    ...(value.expected_turn_id === undefined ? {} : { expected_turn_id: value.expected_turn_id }),
    idempotency_key: idempotencyKey,
    args: value,
    ...(inboundHop === undefined || inboundHop <= 0 ? {} : { inbound_hop: inboundHop }),
    ...(authority === undefined ? {} : { authority }),
  })
  if (sent.kind === "error") return { kind: "error", error: sent.error }
  if ("device" in sent) {
    // The relay leg answers with the same delivery facts as the local one (#13014, #13036); it knows no endpoint on that device.
    const facts = {
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
        cwd: escapeForDisplay(row.project),
        created_at: seen,
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
    delivery_id: sent.delivery_id,
    effective_mode: sent.effective_mode,
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
 * Registers the fourteen tools, a removed-tool hint for each chat-binding tool sessions no longer have, and with `pi.on`
 * the store extensions' session tools at each `session_start` (`tools/extension-tools.ts`); `dispose` (shutdown) cancels
 * the relay's background retries and drops the receipt-recovery keys.
 */
export function registerThreadTools(
  pi: ExtensionToolHost,
  options: ThreadToolSurfaceOptions,
  log: (line: string) => void = () => undefined,
): { readonly dispose: () => void } {
  const built = buildThreadTools(options)
  // Thread tools run on the loop side of a split session (engine `ToolDefinition.runs`).
  for (const tool of built.tools) pi.registerTool({ ...tool, runs: "brain" })
  if (pi.on !== undefined)
    registerExtensionTools(pi as ExtensionToolHost & Required<Pick<ExtensionToolHost, "on">>, options, log)
  return { dispose: built.dispose }
}

type ConsumedSender = { readonly session_id: string; readonly device?: string }

/**
 * This device's own id, read only when a consumed sender names a device: a sender naming it is a sender on this device.
 * A failed read is a typed host_unavailable, never undefined: without the id a sender on this device cannot be told from
 * one on another device, and guessing "another device" would route a local reply through the relay (#13218 review).
 */
async function thisDeviceOf(
  options: ThreadToolSurfaceOptions,
  senders: readonly ConsumedSender[],
): Promise<string | undefined | ThreadToolFailure> {
  if (options.remote === undefined || !senders.some((sender) => sender.device !== undefined)) return undefined
  try {
    return (await accountDevices(options.remote.client)).here ?? undefined
  } catch (error) {
    const devices = [...new Set(senders.flatMap((sender) => (sender.device === undefined ? [] : [sender.device])))]
    return threadToolFailure(
      "host_unavailable",
      "This device's id could not be read, so a reply to a sender named by its device cannot be routed; nothing was sent.",
      "Retry when the device service is reachable.",
      { devices, reason: error instanceof Error ? error.message : String(error) },
    )
  }
}

/**
 * #14048: the refusal of a reply to an unattested sender whose durable id more than one device lists (this device's entries
 * and the account listing), as the account-wide lookup answers several holders; undefined when one device lists it.
 */
async function unattestedSenderAmbiguity(
  options: ThreadToolSurfaceOptions,
  local: readonly ThreadAddressEntry[],
  sessionId: string,
): Promise<ThreadToolFailure | undefined> {
  if (options.remote === undefined) return undefined
  const book = await relayAddressBook(options.remote, sessionId).catch((error: unknown): RelayAddressBook => ({
    entries: [],
    unavailable: threadToolFailure(
      "host_unavailable",
      "The account's session listing could not be read again to confirm the sender's device.",
      "Retry when the device service is reachable.",
      { reason: error instanceof Error ? error.message : String(error) },
    ),
  }))
  if (book.unavailable !== undefined) return book.unavailable
  const devices = [
    ...new Set([...local, ...book.entries].filter((e) => e.thread_id === sessionId).map((e) => e.device ?? "")),
  ]
  if (devices.length <= 1) return undefined
  return threadToolFailure(
    "ambiguous_target",
    `Session ${sessionId} is listed on more than one device and this run's delivery names none; nothing was sent.`,
    "Address the session on one device with <device>/<session id>.",
    { candidates: devices.map((device) => ({ id: sessionId, ...(device === "" ? {} : { device }) })) },
  )
}

/**
 * Whether `address` is an approved reply to a consumed sender on another device, or names such senders ambiguously
 * (`leaves`), with this device's id as read for that decision (`here`, when `read`), which `locate` reuses.
 */
async function replyRoute(
  options: ThreadToolSurfaceOptions,
  address: string,
): Promise<{
  readonly leaves: boolean
  readonly read: boolean
  readonly here?: string | undefined | ThreadToolFailure
}> {
  const senders = consumedSendersOf(options, address)
  if (!senders.some((sender) => sender.device !== undefined)) return { leaves: false, read: false }
  const here = await thisDeviceOf(options, senders)
  // An unreadable device id takes no local listing either: the send answers that failure (sendTarget) before any route.
  if (typeof here === "object") return { leaves: true, read: true, here }
  const replyTo = replySender(address, senders, here)
  return { leaves: replyTo !== undefined && ("code" in replyTo || replyTo.device !== undefined), read: true, here }
}

/**
 * The one consumed sender a reply addresses, its device absent for this device; undefined when the send is no reply. One
 * session id stated from two devices, or one name stated by two senders, is ambiguous_target: none is picked.
 */
function replySender(
  address: string,
  senders: readonly ConsumedSender[],
  here: string | undefined,
): { readonly session_id: string; readonly device: string | undefined } | ThreadToolFailure | undefined {
  const distinct = new Map<string, { readonly session_id: string; readonly device: string | undefined }>()
  for (const sender of senders) {
    const device = otherDevice(sender.device, here)
    distinct.set(JSON.stringify([sender.session_id, device ?? null]), { session_id: sender.session_id, device })
  }
  const found = [...distinct.values()]
  if (found.length <= 1) return found[0]
  return threadToolFailure(
    "ambiguous_target",
    `"${address}" names more than one sender of this run's deliveries; none was picked.`,
    "Send to the intended thread as a normal send, by its id.",
    {
      candidates: found.map((sender) => ({
        thread: sender.session_id,
        ...(sender.device === undefined ? {} : { device: sender.device }),
      })),
    },
  )
}
