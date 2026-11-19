import { randomUUID } from "node:crypto"
import { userInfo } from "node:os"
import type { DeviceService } from "@oh-my-opencode/device-service-core/device-service"
import type { ThreadThinkingLevel, ThreadToolResult } from "../thread/contracts"
import { isPermissionPreset, presetWithin } from "../thread/contracts/permission-presets"
import { answered, closeThread, setModelOn, setThinkingLevelOn } from "../thread/control/operations"
import { ControlRefusal, type SessionControl } from "../thread/control/port"
import { createRelayControl } from "../thread/control/relay-control"
import { createRelaySessionHost } from "../thread/control/relay-session-host"
import type { SessionOpenRequest } from "../thread/control/session-host"
import type { ThreadToolFailure } from "../thread/errors"
import { hashArgs } from "../thread/gateway/bindings"
import { resolveProvenance } from "../thread/gateway/provenance-resolver"
import type { ToolReceiptBegin } from "../thread/gateway/store-relay-ops"
import type { GatewaySender } from "../thread/gateway/types"
import { namedDeviceRow } from "../thread/remote/address-book"
import { outcomeFailure } from "../thread/remote/outcome"
import type { JsonObject, RemoteThreadSurface } from "../thread/remote/ports"
import { createRelayTransport, type RelayTransportOptions } from "../thread/remote/relay-transport"
import { replyData } from "../thread/remote/remote-ops"
import { stampThisDevice } from "../thread/remote/this-device"
import { type ClientCore, ok, type Outcome, type RemoteClient } from "./client"
import { nextActionFor, readFailureFromError, remoteFailure } from "./codes"
import { DEADLINES } from "./deadlines"
import { createDeviceServiceSessions } from "./port/device-service"
import { canonicalizeThreadHandle, handleOf } from "./seams"
import { clientMessageIdOf } from "./client-message-id"
import type { LocalSessions } from "./local-sessions"
import { sessionDetail } from "./session-detail"
import type {
  DeviceRow,
  SessionRow,
  InterruptJob,
  InterruptResult,
  OpenRequest,
  OpenResult,
  Opts,
  R,
  RemoteFailure,
  SendReceipt,
  SendRequest,
  ThreadHandle,
} from "./types"

type SessionMembers = Pick<
  RemoteClient["sessions"],
  "get" | "open" | "send" | "read" | "interrupt" | "setModel" | "setReasoning" | "close" | "archive"
>

type Target = { readonly device: string; readonly session: string }
/** The options of one stage of a call, under what is left of the call's one deadline (capped at `capMs`). */
type Stage = (capMs?: number) => Opts

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

/** A thread tools failure as the remote module answers it: the same code and details, an SDK next action. */
const fromThread = (error: ThreadToolFailure, extra: Partial<RemoteFailure> = {}): RemoteFailure =>
  NO_SESSION.has(error.details?.["reason"]) && typeof error.details?.["device"] === "string"
    ? { ...unknownSession(error.details["device"]), ...extra }
    : remoteFailure(error.code, error.message, nextActionFor(error.code), {
        ...(error.code === "idempotency_uncertain" ? { uncertain: true } : {}),
        ...(error.details === undefined ? {} : { details: error.details }),
        ...extra,
      })

/** A session handle names its device; any other address is resolved first (sessions.resolve). */
const targetOf = (thread: ThreadHandle): Target | RemoteFailure => {
  const parsed = canonicalizeThreadHandle(thread, {})
  if (parsed.kind === "error") return parsed
  const { target } = parsed.value
  if (target.kind === "device_session") return { device: target.device, session: target.session }
  return remoteFailure(
    "invalid_arguments",
    `${thread} names no device; a session member takes a <device>/<session> handle.`,
    "Call sessions.resolve for the thread's handle, then call this again.",
  )
}

/** "provider/id", split at the first slash; anything else is not a model a session can run. */
const splitModel = (model: string): { readonly provider: string; readonly modelId: string } | RemoteFailure => {
  const slash = model.indexOf("/")
  if (slash <= 0 || slash === model.length - 1)
    return remoteFailure(
      "invalid_arguments",
      `model ${JSON.stringify(model)} is not a provider/id.`,
      "Pass the exact provider/id the device lists, then call this again.",
      { details: { model } },
    )
  return { provider: model.slice(0, slash), modelId: model.slice(slash + 1) }
}

// #13748: SessionOpenRequest takes these itself; dev's relay host already puts them on the open_session frame.
type LaunchProfile = { readonly provider?: string; readonly modelId?: string; readonly thinkingLevel?: string }

/** The one translation of an OpenRequest into the shared create path's request (thread_create's SessionOpenRequest). */
const openRequestOf = (request: OpenRequest): (SessionOpenRequest & LaunchProfile) | RemoteFailure => {
  const model = request.model === undefined ? undefined : splitModel(request.model)
  if (model !== undefined && "kind" in model) return model
  return {
    ...(request.workspace === undefined ? {} : { cwd: request.workspace }),
    ...(request.name === undefined ? {} : { name: request.name }),
    ...(request.initial_skills === undefined ? {} : { initialSkills: request.initial_skills }),
    ...(request.preset === undefined ? {} : { permissionPreset: request.preset }),
    ...(request.worktree === undefined ? {} : { worktree: request.worktree }),
    ...(model ?? {}),
    ...(request.reasoning === undefined ? {} : { thinkingLevel: request.reasoning }),
  }
}

// #13748: open-reply.ts `modelRefusal` maps the engine's `model_unavailable: <why>` refusal on the relay leg itself.
const modelUnavailable = (failure: RemoteFailure, model: string | undefined): RemoteFailure =>
  model !== undefined && /\bmodel_unavailable\b/.test(String(failure.details?.["reason"] ?? ""))
    ? remoteFailure(
        "model_not_found",
        `No session was created: the device cannot run ${model}.`,
        nextActionFor("model_not_found"),
        {
          details: { ...failure.details, reason: "model_unavailable", model },
        },
      )
    : failure

const isJob = (value: unknown): value is InterruptJob =>
  isObject(value) && typeof value["kind"] === "string" && typeof value["id"] === "string"

/** senpi#6675's per-job report of the interrupted turn's background jobs; an engine without it reports none. */
const backgroundOf = (value: unknown): InterruptResult["background"] => {
  if (!isObject(value) || value["status"] !== "stopped") return { status: "not_supported" }
  const { stopped, failed } = value
  if (!Array.isArray(stopped) || !Array.isArray(failed)) return { status: "not_supported" }
  return {
    status: "stopped",
    stopped: stopped.filter(isJob),
    failed: failed.filter(
      (job): job is InterruptJob & { readonly reason: string } =>
        isObject(job) && typeof job["reason"] === "string" && isJob(job),
    ),
  }
}

const unknownSession = (device: string, session?: string): RemoteFailure =>
  remoteFailure(
    "not_found",
    `Device ${device} holds no session${session === undefined ? " by that handle" : ` ${session}`}.`,
    "Call sessions.list or sessions.resolve for the session's current handle.",
    { details: { kind: "session", device } },
  )

// The engine's and the device service's words for a session the device does not hold (port/device-service.ts reports
// session_not_found as unknown_session): a member answers them not_found{session}, never as a refusal to update for.
const NO_SESSION: ReadonlySet<unknown> = new Set(["unknown_session", "session_not_found"])

/** A resolved session: the session part a member sends to its device, and its listing row when the device lists it. */
export type SessionTarget = { readonly device: string; readonly session: string; readonly row?: SessionRow }

/**
 * The one resolution of a handle's session part (the device's listing key or the session's durable id), for every session
 * member and resolve.ts: the listed row with that key, else the listed row with that durable id; a session the listing
 * does not carry (yet) goes to its device as named, where the port's attach locates it (#13748).
 */
export async function resolveSessionTarget(
  core: ClientCore,
  device: string,
  session: string,
  opts?: Opts,
): Promise<Outcome<SessionTarget>> {
  const listed = await core.sessionsList({ device }, opts)
  if (listed.kind === "error") return listed
  const rows = listed.value.rows.filter((row) => row.device.id === device)
  const byKey = rows.find((row) => row.thread === handleOf(device, session))
  if (byKey !== undefined) return ok({ device, session, row: byKey })
  const byDurable = rows.find((row) => row.durable_id === session)
  const keyed = byDurable === undefined ? undefined : canonicalizeThreadHandle(byDurable.thread, {})
  if (byDurable !== undefined && keyed?.kind === "ok" && keyed.value.target.kind === "device_session")
    return ok({ device, session: keyed.value.target.session, row: byDurable })
  return ok({ device, session })
}

/**
 * A person's one identity on a send, as `omo remote send` builds it: the client's fixed uid (this process's own when
 * it is not numeric) and this user's name; the receipt principal is that uid.
 */
export function personIdentity(uid: string): { readonly sender: GatewaySender; readonly caller: string } {
  const numeric = /^\d+$/.test(uid) ? Number(uid) : (process.getuid?.() ?? 0)
  return { sender: { kind: "person", uid: numeric, user: userInfo().username }, caller: `person:${uid}` }
}

/** A session's message to a session on its own device: its thread tools deliver it, never this client. */
// A client built without this device's operator endpoint (RemoteClientDeps.localSessions) reaches no session on it.
const noLocalSessions = (device: string): RemoteFailure =>
  remoteFailure(
    "unsupported",
    "This client cannot reach a session on its own device: it was built without this device's operator endpoint.",
    "Call this member on a client built with localSessions.",
    { details: { feature: "local_sessions", device } },
  )

const selfDelivery = (device: string): RemoteFailure =>
  remoteFailure(
    "local_only",
    "A session's message to a session on its own device is delivered by that device's thread tools.",
    "Send it from the calling session's thread tools (thread_send); sessions.send reaches other devices.",
    { details: { device } },
  )

/** How many idempotency keys a client remembers for replay, in each of its stores (opens, sends, send receipts). */
const KEYS_KEPT = 256

/**
 * Every idempotency store's one rule: `entry` is kept under `key` as the newest, and past KEYS_KEPT the oldest settled
 * entries are forgotten; one still in flight is never dropped, or its repeat would run again.
 */
function keepNewest<V extends { readonly settled: boolean }>(held: Map<string, V>, key: string, entry: V): void {
  held.set(key, entry)
  for (const [oldest, kept] of held) {
    if (held.size <= KEYS_KEPT) break
    if (kept.settled) held.delete(oldest)
  }
}

/**
 * The receipts of this client's sends and opens: a repeat under one idempotency key replays the first answer. A send
 * without a key keeps a receipt under a fresh one nobody can retry, so the store keeps the newest (keepNewest).
 */
function createReceipts(now: () => number): RelayTransportOptions["store"] {
  type Receipt = { readonly hash: string; settled: boolean; result?: unknown; note?: string }
  const held = new Map<string, Receipt>()
  const keyOf = (scope: { readonly principal: string; readonly operation: string; readonly idempotency_key: string }) =>
    `${scope.principal}\u0000${scope.operation}\u0000${scope.idempotency_key}`
  return {
    now,
    toolReceiptBegin: async (request): Promise<ToolReceiptBegin> => {
      const known = held.get(keyOf(request))
      if (known === undefined) {
        keepNewest(held, keyOf(request), { hash: request.args_hash, settled: false })
        return { kind: "accepted" }
      }
      if (known.hash !== request.args_hash) return { kind: "conflict" }
      if (!known.settled) return { kind: "in_progress" }
      if (known.note !== undefined) return { kind: "uncertain", error_note: known.note }
      return { kind: "replay", result: known.result }
    },
    toolReceiptSettle: async (request) => {
      const known = held.get(keyOf(request))
      if (known === undefined) return false
      known.settled = true
      if ("result" in request) known.result = request.result
      else known.note = request.error_note
      return true
    },
    toolReceiptRevise: async (request) => {
      const known = held.get(keyOf(request))
      if (known === undefined || !known.settled) return false
      known.result = request.result
      return true
    },
    // A send that wrote nothing drops its unsettled receipt, so the same key runs again (the gateway store's rule, #12925).
    toolReceiptRelease: async (request) => {
      const known = held.get(keyOf(request))
      if (known === undefined || known.settled) return false
      return held.delete(keyOf(request))
    },
    deliveryView: async () => null,
  }
}

/**
 * The session members of part 4a-2 (unit U1 of #13414), each the thread tools' own body over the account half of the
 * thread port on this client's connection: open is thread_create's relay SessionHost, send the relay transport, close,
 * the model and the thinking level the control bodies; nothing re-implements the engine records they send.
 */
export function sessionMembers(core: ClientCore): SessionMembers {
  const { sender } = core
  const receipts = createReceipts(() => core.timers.now())
  // Keyed opens, newest last: a repeat replays (and refreshes) one; past KEYS_KEPT the oldest settled is forgotten.
  const opens = new Map<string, { readonly hash: string; readonly result: R<OpenResult>; settled: boolean }>()
  const legs = new WeakMap<
    DeviceService,
    { readonly remote: RemoteThreadSurface; readonly relay: ReturnType<typeof createRelayTransport> }
  >()
  // One port per proven connection: a rebuilt connection gets a new one; the port never closes the shared connection.
  // An open_session rides a connection of its own, closed once it settles, as `omo remote open` does (#13761): opened
  // on the shared one, the host's delegated engine connection attaches to it too and every streamed delta arrives twice.
  const legOf = (svc: DeviceService) => {
    const known = legs.get(svc)
    if (known !== undefined) return known
    const port = createDeviceServiceSessions({
      version: core.deps.version,
      connect: async () => ({ conn: svc, owned: false }),
      dialEndpoint: async () => ({ conn: await core.dial(), owned: true }),
    })
    const remote: RemoteThreadSurface = {
      // The thread bodies this member runs read the account through the client they belong to (#13414 U5).
      client: core.self(),
      sessions: {
        ...port,
        // The account's device listing may leave out this device, which only thisDevice() names; a connected service's
        // own device is online, so the relay host's online check finds it.
        devices: async () => {
          const [rows, self] = await Promise.all([port.devices(), svc.thisDevice()])
          return self === null || rows.some((row) => row.device === self.id)
            ? rows
            : [{ device: self.id, label: self.name, online: true }, ...rows]
        },
      },
      chain: { stamp: (record) => record },
    }
    const relay = createRelayTransport({
      remote,
      store: receipts,
      senderProvenance: () => stampThisDevice(resolveProvenance({ cwd: process.cwd(), env: process.env }), remote),
    })
    const leg = { remote, relay }
    legs.set(svc, leg)
    return leg
  }

  /**
   * One deadline for a whole call (#13756 L3): its clock starts once, and each stage (the listing, the device row, the
   * member) runs under what is left of it, a stage's own table default capping its share.
   */
  const budget = (opts: Opts | undefined, totalMs: number): Stage => {
    const end = core.timers.now() + (opts?.deadlineMs ?? totalMs)
    return (capMs) => {
      const left = Math.max(1, end - core.timers.now())
      return {
        ...(opts?.signal === undefined ? {} : { signal: opts.signal }),
        deadlineMs: capMs === undefined ? left : Math.min(capMs, left),
      }
    }
  }
  // An open with a first prompt spends the create's and one send's default.
  const openBudget = (request: OpenRequest, opts: Opts | undefined): Stage =>
    budget(opts, DEADLINES.openEndpoint + (request.first === undefined ? 0 : DEADLINES.drive))

  const deviceRow = async (id: string, opts: Opts | undefined): Promise<Outcome<DeviceRow>> => {
    const listed = await core.devicesList(opts)
    if (listed.kind === "error") return listed
    const row = listed.value.find((candidate) => candidate.id === id)
    return row === undefined
      ? remoteFailure("not_found", `No device has the id ${id}.`, nextActionFor("not_found"), {
          details: { kind: "device" },
        })
      : ok(row)
  }

  // The relay control of one session: a control body's typed refusal is answered as data by `answered`.
  const controlOf = (svc: DeviceService, { device, session }: Target): SessionControl =>
    createRelayControl(legOf(svc).remote, namedDeviceRow(device, session))

  // A session on this device is served by its own operator endpoint: the relay cannot route to the device that asks.
  const onThisDevice = async <T>(
    device: string,
    body: (members: LocalSessions["members"]) => Promise<Outcome<T>>,
  ): Promise<Outcome<T>> => {
    const leg = await core.localSessions()
    return leg === undefined ? noLocalSessions(device) : await body(leg.members)
  }
  // A person's sends on this device under an idempotency key, newest last: a repeat replays one, other arguments
  // conflict, and one that ran nothing frees its key (the relay leg's receipts do this for other devices).
  const localSends = new Map<
    string,
    { readonly hash: string; readonly result: Promise<Outcome<SendReceipt>>; settled: boolean }
  >()
  const localSend = async (
    thread: ThreadHandle,
    target: SessionTarget,
    device: DeviceRow,
    request: SendRequest,
    caller: string,
  ): Promise<Outcome<SendReceipt>> => {
    const run = () =>
      onThisDevice(target.device, (local) =>
        local.send(target, thread, device, request, clientMessageIdOf(caller, request.idempotency_key)),
      )
    const key = request.idempotency_key
    if (key === undefined) return await run()
    const hash = hashArgs({ thread, text: request.text, mode: request.mode, expected: request.expected_turn_id })
    const known = localSends.get(key)
    if (known !== undefined)
      return known.hash === hash
        ? await known.result
        : remoteFailure(
            "idempotency_conflict",
            "The idempotency key was already used for another send.",
            nextActionFor("idempotency_conflict"),
          )
    const entry = { hash, result: run(), settled: false }
    keepNewest(localSends, key, entry)
    const settled = await entry.result
    entry.settled = true
    if (settled.kind === "error" && settled.uncertain !== true) localSends.delete(key)
    return settled
  }
  const isThisDevice = async (svc: DeviceService, device: string): Promise<boolean> =>
    (await svc.thisDevice())?.id === device

  const resolve = async (thread: ThreadHandle, stage: Stage): Promise<Outcome<SessionTarget>> => {
    const named = targetOf(thread)
    return "kind" in named
      ? named
      : await resolveSessionTarget(core, named.device, named.session, stage(DEADLINES.sessionsList))
  }

  const controlled = async <T>(
    thread: ThreadHandle,
    opts: Opts | undefined,
    body: (control: SessionControl, target: Target, svc: DeviceService) => Promise<ThreadToolResult>,
    value: (result: ThreadToolResult) => T,
    onThisDevice: (target: SessionTarget) => Promise<Outcome<T>>,
  ): R<T> => {
    const stage = budget(opts, DEADLINES.drive)
    const resolved = await resolve(thread, stage)
    if (resolved.kind === "error") return resolved
    const target = resolved.value
    return core.member(stage(), DEADLINES.drive, true, async (svc) => {
      if (await isThisDevice(svc, target.device)) return await onThisDevice(target)
      const result = await answered(() => body(controlOf(svc, target), target, svc))
      return result.kind === "error" ? fromThread(result.error) : ok(value(result))
    })
  }

  /** Who the relay transport delivers as: a person's input is a prompt; a session's message is a delivery. */
  const gatewaySender = (): { readonly sender: GatewaySender; readonly caller: string } | RemoteFailure => {
    switch (sender.kind) {
      case "person":
      case "cli":
        return personIdentity(sender.uid)
      case "session":
        return { sender: { kind: "session", durable_id: sender.id }, caller: sender.id }
      case "connector":
        return remoteFailure(
          "unsupported",
          "A connector client cannot send to a session through sessions.send yet.",
          nextActionFor("unsupported"),
          { details: { feature: "connector_send" } },
        )
      case "service":
        return remoteFailure(
          "sender_not_allowed",
          "The device service client sends no messages.",
          "Call sessions.send on a person or session client.",
        )
    }
  }

  const send = async (thread: ThreadHandle, request: SendRequest, opts?: Opts): R<SendReceipt> => {
    const stage = budget(opts, DEADLINES.drive)
    const resolved = await resolve(thread, stage)
    if (resolved.kind === "error") return resolved
    return await deliverTo(thread, resolved.value, request, stage)
  }

  /** One send to the session the device lists under `target` (already resolved); `thread` is the caller's handle. */
  const deliverTo = async (
    thread: ThreadHandle,
    target: SessionTarget,
    request: SendRequest,
    stage: Stage,
  ): R<SendReceipt> => {
    if (request.author !== undefined && sender.kind !== "connector")
      return remoteFailure(
        "invalid_arguments",
        "Only a connector client names an author.",
        nextActionFor("invalid_arguments"),
      )
    if (request.attachments !== undefined && request.attachments.length > 0)
      return remoteFailure(
        "unsupported",
        "A send to another device carries no attachments yet.",
        nextActionFor("unsupported"),
        {
          details: { feature: "attachments" },
        },
      )
    const from = gatewaySender()
    if ("kind" in from) return from
    const device = await deviceRow(target.device, stage(DEADLINES.devices))
    if (device.kind === "error") return device
    return core.member<SendReceipt>(stage(), DEADLINES.drive, true, async (svc) => {
      if (await isThisDevice(svc, target.device))
        return from.sender.kind === "person"
          ? await localSend(thread, target, device.value, request, from.caller)
          : selfDelivery(target.device)
      const row = namedDeviceRow(target.device, target.session)
      const mode = request.mode ?? "auto"
      const expected = request.expected_turn_id === undefined ? undefined : String(request.expected_turn_id)
      // A person's followUp prompt carries a client message id, the receipt's delivery_id: every record of the turn that
      // answers it carries it too. The relay's steer record carries none, so a steer names none.
      const clientMessageId =
        from.sender.kind === "person" && mode !== "steer"
          ? clientMessageIdOf(from.caller, request.idempotency_key)
          : undefined
      const sent = await legOf(svc).relay.deliver({
        sender: from.sender,
        caller_id: from.caller,
        target: { kind: "remote", row },
        text: request.text,
        mode,
        ...(expected === undefined ? {} : { expected_turn_id: expected }),
        idempotency_key: request.idempotency_key ?? randomUUID(),
        ...(clientMessageId === undefined ? {} : { client_message_id: clientMessageId }),
        args: { thread, text: request.text, mode, expected_turn_id: expected },
      })
      if (sent.kind === "error") return fromThread(sent.error)
      if (!("device" in sent))
        return remoteFailure(
          "internal_error",
          `A send to ${thread} was not answered by its device.`,
          nextActionFor("internal_error"),
        )
      const base = {
        thread,
        device: device.value,
        ...((sent.delivery_id ?? clientMessageId) === undefined
          ? {}
          : { delivery_id: sent.delivery_id ?? clientMessageId }),
      }
      const { delivery } = sent
      switch (delivery.kind) {
        case "started":
        case "steered":
          return ok({ ...base, lane: delivery.kind, ...(delivery.turn_id === "" ? {} : { turn_id: delivery.turn_id }) })
        case "queued":
          // A delivery that waits on a wake is offline there; one behind an approval names it; a hold is plain queued.
          if (delivery.waiting_on?.kind === "wake")
            return ok({ ...base, lane: "queued_offline", queue_position: delivery.queue_position, wake: "started" })
          return ok({
            ...base,
            lane: "queued",
            queue_position: delivery.queue_position,
            ...(delivery.waiting_on?.kind === "approval"
              ? {
                  waiting_on: {
                    kind: "approval",
                    ...(delivery.waiting_on.device === undefined ? {} : { device: delivery.waiting_on.device }),
                  },
                }
              : {}),
          })
        case "queued_offline":
          return ok({ ...base, lane: "queued_offline", queue_position: delivery.queue_position, wake: "none" })
      }
    })
  }

  const open = async (request: OpenRequest, opts?: Opts): R<OpenResult> => {
    const translated = openRequestOf(request)
    if ("kind" in translated) return translated
    let asked = translated
    const preset = request.preset
    // A person (at a terminal or not) opens in the mode it names (absent, the engine's own default). A caller that acts
    // for a session may keep or narrow that session's mode; absent, it keeps it. Not told its mode, only `ask` passes, and
    // an open without a preset asks for `ask`.
    if (sender.kind === "session" || sender.kind === "connector") {
      const told = core.deps.permissionPreset?.()
      const own = told !== undefined && isPermissionPreset(told) ? told : undefined
      if (preset !== undefined && !presetWithin(preset, own))
        return remoteFailure(
          "scope_denied",
          `This client acts in ${own ?? "an unknown approval mode"}; a session it opens cannot run in ${preset}, which allows more.`,
          "Call sessions.open with this session's own mode or a narrower one (ask is always allowed), or without a preset.",
          { details: { reason: "permission_preset_wider", requested: preset, ...(own === undefined ? {} : { own }) } },
        )
      // Never the device default, which may allow more than the mode this caller acts in.
      if (preset === undefined) asked = { ...asked, permissionPreset: own ?? "ask" }
    }
    const key = request.idempotency_key
    if (key === undefined) return await openOnce(request, asked, openBudget(request, opts))
    // A repeat under the key replays the first open (in flight or settled); one with other arguments conflicts. An
    // open that created nothing frees the key for a retry.
    const hash = hashArgs(request)
    const known = opens.get(key)
    if (known !== undefined) {
      opens.delete(key)
      opens.set(key, known)
    }
    if (known !== undefined)
      return known.hash === hash
        ? await known.result
        : remoteFailure(
            "idempotency_conflict",
            "The idempotency key was already used for another open.",
            nextActionFor("idempotency_conflict"),
          )
    const entry = { hash, result: openOnce(request, asked, openBudget(request, opts)), settled: false }
    keepNewest(opens, key, entry)
    const settled = await entry.result
    entry.settled = true
    if (settled.kind === "error" && settled.partial === undefined && settled.uncertain !== true) opens.delete(key)
    return settled
  }

  const openOnce = async (
    request: OpenRequest,
    asked: SessionOpenRequest & LaunchProfile,
    stage: Stage,
  ): R<OpenResult> => {
    const made = await core.member(
      stage(DEADLINES.openEndpoint),
      DEADLINES.openEndpoint,
      true,
      async (svc) => {
        const device = await deviceRow(request.device, stage(DEADLINES.devices))
        if (device.kind === "error") return device
        // This device opens on its own operator endpoint, never through the relay to itself (#13787).
        if (device.value.self === true) {
          // A session's message to a session on its own device belongs to its thread tools: refused before the open.
          if (request.first !== undefined && sender.kind !== "person" && sender.kind !== "cli")
            return selfDelivery(device.value.id)
          const leg = await core.localSessions()
          if (leg === undefined) return noLocalSessions(device.value.id)
          const local = await leg.open(device.value.id, asked)
          if (local.kind === "ok") return ok({ device: device.value, key: local.key, warnings: [] })
          return "error" in local ? fromThread(local.error) : modelUnavailable(local, request.model)
        }
        const outcome = await createRelaySessionHost(legOf(svc).remote, device.value.id).open(asked)
        if (outcome.kind === "error") return modelUnavailable(fromThread(outcome.error), request.model)
        return ok({
          device: device.value,
          key: outcome.thread.sessionId,
          warnings: (outcome.thread.warnings ?? []).map((warning) => warning.message),
        })
      },
      // No device service on this device (the connection says so, not a row): the operator endpoint could open a session,
      // but no handle would address it, since every session member reaches a session through the service.
      () =>
        request.device === "local"
          ? remoteFailure(
              "local_only",
              "This device has no device service, so a session can only be opened here from inside omo.",
              "Call service.bootstrap to install the device service, then call sessions.open again.",
            )
          : remoteFailure("not_found", `No device has the id ${request.device}.`, nextActionFor("not_found"), {
              details: { kind: "device" },
            }),
    )
    if (made.kind === "error") return made
    const target = { device: made.value.device.id, session: made.value.key }
    const thread = handleOf(target.device, target.session)
    const result: OpenResult = {
      thread,
      device: made.value.device,
      ...(made.value.warnings.length === 0 ? {} : { warnings: made.value.warnings }),
    }
    if (request.first === undefined) return ok(result)
    // The session's own key, as its device named it: a just-created session is not in the listing yet.
    const first = await deliverTo(
      thread,
      target,
      {
        ...request.first,
        ...(request.idempotency_key === undefined ? {} : { idempotency_key: request.idempotency_key }),
      },
      stage,
    )
    // The session exists either way: a first prompt that failed names it, so a retry does not open another one.
    if (first.kind === "error") return { ...first, partial: result }
    return ok({ ...result, receipt: first.value })
  }

  const engineState = (svc: DeviceService, { device, session }: Target): Promise<Outcome<JsonObject>> =>
    legOf(svc)
      .remote.sessions.sessionCommand(device, session, { type: "get_state", sessionId: session })
      .then((outcome) =>
        outcome.kind === "ok" ? ok(replyData(outcome.response)) : fromThread(outcomeFailure(outcome, device).error),
      )

  return {
    open,
    send,
    get: async (thread, opts) => {
      const stage = budget(opts, DEADLINES.observeRead)
      const resolved = await resolve(thread, stage)
      if (resolved.kind === "error") return resolved
      const target = resolved.value
      // A session the listing does not carry yet (one just opened) is read from its device as named, like every member:
      // only the device's own unknown_session makes it not_found.
      return core.member(stage(), DEADLINES.observeRead, false, async (svc) => {
        const device = await deviceRow(target.device, stage(DEADLINES.devices))
        if (device.kind === "error") return device
        if (await isThisDevice(svc, target.device))
          return await onThisDevice(target.device, (local) => local.get(target, thread, device.value))
        const state = await engineState(svc, target)
        if (state.kind === "error") return state
        return ok(sessionDetail(handleOf(target.device, target.session), device.value, target.row, state.value))
      })
    },
    read: async (thread, page, opts) => {
      const stage = budget(opts, DEADLINES.observeRead)
      const resolved = await resolve(thread, stage)
      if (resolved.kind === "error") return resolved
      const target = resolved.value
      return core.member(stage(), DEADLINES.observeRead, false, async (svc) => {
        if (await isThisDevice(svc, target.device))
          return await onThisDevice(target.device, (local) => local.read(target, page))
        const attached = await svc.attach(target.device, target.session)
        try {
          return await attached
            .read({
              ...(page?.before === undefined ? {} : { before: page.before }),
              ...(page?.tail === undefined ? {} : { tail: page.tail }),
            })
            .then(ok, readFailureFromError)
        } finally {
          await attached.detach()
        }
      })
    },
    // The engine's interrupt record itself (relay-control's body drops the background report InterruptResult carries).
    interrupt: async (thread, opts) => {
      const stage = budget(opts, DEADLINES.drive)
      const resolved = await resolve(thread, stage)
      if (resolved.kind === "error") return resolved
      const target = resolved.value
      return core.member(stage(), DEADLINES.drive, true, async (svc) => {
        if (await isThisDevice(svc, target.device))
          return await onThisDevice(target.device, (local) => local.interrupt(target, thread))
        const { device, session } = target
        const outcome = await legOf(svc).remote.sessions.sessionCommand(device, session, {
          type: "interrupt",
          sessionId: session,
        })
        if (outcome.kind !== "ok") return fromThread(outcomeFailure(outcome, device).error)
        const reply = replyData(outcome.response)
        const turn = text(reply["turnId"])
        return ok({
          thread,
          ...(turn === undefined ? {} : { turn_id: turn }),
          interrupted: reply["interrupted"] === true,
          background: backgroundOf(reply["background"]),
          device,
        })
      })
    },
    setModel: async (thread, model, opts) => {
      const wanted = splitModel(model)
      if ("kind" in wanted) return wanted
      return controlled(
        thread,
        opts,
        // The thread tools' matching body, with set_model scoped to the session: never the device's default model.
        (control, { device, session }, svc) =>
          setModelOn(
            {
              ...control,
              setModel: async (provider, id) => {
                const outcome = await legOf(svc).remote.sessions.sessionCommand(device, session, {
                  type: "set_model",
                  sessionId: session,
                  provider,
                  modelId: id,
                  scope: "session",
                })
                if (outcome.kind !== "ok") throw new ControlRefusal(outcomeFailure(outcome, device).error)
                const reply = replyData(outcome.response)
                return { provider: text(reply["provider"]) ?? provider, id: text(reply["id"]) ?? id }
              },
            },
            wanted.modelId,
            wanted.provider,
          ),
        (result) => ({
          model: "model" in result && isObject(result.model) ? `${result.model.provider}/${result.model.id}` : model,
        }),
        // This device's host sets a model only as its default for every session, never this session's own.
        async ({ device }) =>
          remoteFailure(
            "unsupported",
            "A session on this device cannot have its own model set from a client yet; its host would change the device's default.",
            nextActionFor("unsupported"),
            { details: { feature: "session_model_on_this_device", device } },
          ),
      )
    },
    // scope turn is the engine's only session-local thinking level (session scope rewrites the model's remembered one).
    // The engine judges the level; one it cannot run answers thinking_level_unsupported with the supported list.
    setReasoning: async (thread, level, opts) =>
      controlled(
        thread,
        opts,
        (control) => setThinkingLevelOn(control, level as ThreadThinkingLevel, "turn"),
        () => ({ reasoning: level }),
        (target) => onThisDevice(target.device, (local) => local.setReasoning(target, level)),
      ),
    close: async (thread, opts) => {
      const stage = budget(opts, DEADLINES.close)
      const resolved = await resolve(thread, stage)
      if (resolved.kind === "error") return resolved
      const target = resolved.value
      return core.member(stage(), DEADLINES.close, true, async (svc) => {
        if (await isThisDevice(svc, target.device))
          return await onThisDevice(target.device, (local) => local.close(target, opts?.force === true))
        const result = await answered(() => closeThread(controlOf(svc, target), opts?.force))
        if (result.kind === "error") return fromThread(result.error)
        return ok({
          closed: "closed" in result && result.closed === true,
          dropped_deliveries: "dropped_deliveries" in result ? [...result.dropped_deliveries] : [],
        })
      })
    },
    // The thread tools' archive body: senpi set_session_archived on the session, which stays open and running.
    archive: async (thread, archived, opts) =>
      controlled(
        thread,
        opts,
        async (control) => {
          await control.setArchived(archived)
          return { kind: "ok", ...(await control.listed(archived)), archived }
        },
        () => ({ archived }),
        (target) => onThisDevice(target.device, (local) => local.archive(target, archived)),
      ),
  }
}
