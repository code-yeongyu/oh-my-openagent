import { randomUUID } from "node:crypto"
import type { DeviceService } from "@oh-my-opencode/device-service-core/device-service"
import type { ThreadThinkingLevel, ThreadToolResult } from "../thread/contracts"
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
import { nextActionFor, remoteFailure } from "./codes"
import { DEADLINES } from "./deadlines"
import { createDeviceServiceSessions } from "./port/device-service"
import { canonicalizeThreadHandle, handleOf } from "./seams"
import type {
  DeviceRow,
  InterruptJob,
  InterruptResult,
  OpenRequest,
  OpenResult,
  Opts,
  PermissionPreset,
  R,
  RemoteFailure,
  SendReceipt,
  SendRequest,
  SessionDetail,
  ThreadHandle,
} from "./types"

type SessionMembers = Pick<
  RemoteClient["sessions"],
  "get" | "open" | "send" | "read" | "interrupt" | "setModel" | "setReasoning" | "close" | "archive"
>

type Target = { readonly device: string; readonly session: string }

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

/** A thread tools failure as the remote module answers it: the same code and details, an SDK next action. */
const fromThread = (error: ThreadToolFailure, extra: Partial<RemoteFailure> = {}): RemoteFailure =>
  remoteFailure(error.code, error.message, nextActionFor(error.code), {
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

// #13748: thread/contracts/permission-presets.ts `presetWithin` replaces this table (the same senpi preset rules).
const AT_MOST: Readonly<Record<PermissionPreset, readonly PermissionPreset[]>> = {
  "full-access": ["full-access", "workspace", "accept-edits", "auto", "read-only", "ask"],
  workspace: ["workspace", "accept-edits", "read-only", "ask"],
  "accept-edits": ["accept-edits", "read-only", "ask"],
  "read-only": ["read-only", "ask"],
  auto: ["auto", "ask"],
  ask: ["ask"],
}
const presetWithin = (requested: PermissionPreset, creator: PermissionPreset | undefined): boolean =>
  creator === undefined ? requested === "ask" : AT_MOST[creator].includes(requested)

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

/** The receipts of this client's sends and opens: a repeat under one idempotency key replays the first answer. */
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
        held.set(keyOf(request), { hash: request.args_hash, settled: false })
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
  const opens = new Map<string, { readonly hash: string; readonly result: R<OpenResult> }>()
  const legs = new WeakMap<
    DeviceService,
    { readonly remote: RemoteThreadSurface; readonly relay: ReturnType<typeof createRelayTransport> }
  >()
  // One port per proven connection: a rebuilt connection gets a new one; the port never closes the shared connection.
  const legOf = (svc: DeviceService) => {
    const known = legs.get(svc)
    if (known !== undefined) return known
    const remote: RemoteThreadSurface = {
      sessions: createDeviceServiceSessions({ version: core.deps.version, connect: async () => svc }),
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

  const controlled = <T>(
    thread: ThreadHandle,
    opts: Opts | undefined,
    body: (control: SessionControl, target: Target, svc: DeviceService) => Promise<ThreadToolResult>,
    value: (result: ThreadToolResult) => T,
  ): R<T> => {
    const target = targetOf(thread)
    if ("kind" in target) return Promise.resolve(target)
    return core.member(opts, DEADLINES.drive, true, async (svc) => {
      const result = await answered(() => body(controlOf(svc, target), target, svc))
      return result.kind === "error" ? fromThread(result.error) : ok(value(result))
    })
  }

  /** Who the relay transport delivers as: a person's input is a prompt; a session's message is a delivery. */
  const gatewaySender = (): { readonly sender: GatewaySender; readonly caller: string } | RemoteFailure => {
    switch (sender.kind) {
      case "person":
      case "cli": {
        const uid = process.getuid?.() ?? 0
        return { sender: { kind: "person", uid, user: sender.uid }, caller: `person:${uid}` }
      }
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
    const target = targetOf(thread)
    if ("kind" in target) return target
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
    const device = await deviceRow(target.device, opts)
    if (device.kind === "error") return device
    return core.member<SendReceipt>(opts, DEADLINES.drive, true, async (svc) => {
      const row = namedDeviceRow(target.device, target.session)
      const mode = request.mode ?? "auto"
      const expected = request.expected_turn_id === undefined ? undefined : String(request.expected_turn_id)
      const sent = await legOf(svc).relay.deliver({
        sender: from.sender,
        caller_id: from.caller,
        target: { kind: "remote", row },
        text: request.text,
        mode,
        ...(expected === undefined ? {} : { expected_turn_id: expected }),
        idempotency_key: request.idempotency_key ?? randomUUID(),
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
        ...(sent.delivery_id === undefined ? {} : { delivery_id: sent.delivery_id }),
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
    const asked = openRequestOf(request)
    if ("kind" in asked) return asked
    const preset = request.preset
    // A person opens in any mode; any other caller may keep or narrow its own. This client is not told its sender's
    // own mode, so it is unknown here and only `ask` (below every other) passes.
    if (preset !== undefined && sender.kind !== "person" && !presetWithin(preset, undefined))
      return remoteFailure(
        "scope_denied",
        `This client's approval mode is unknown; a session it opens cannot run in ${preset}, which may allow more.`,
        "Call sessions.open with preset ask, or without a preset.",
        { details: { reason: "permission_preset_wider", requested: preset } },
      )
    const key = request.idempotency_key
    if (key === undefined) return await openOnce(request, asked, opts)
    // A repeat under the key replays the first open (in flight or settled); one with other arguments conflicts. An
    // open that created nothing frees the key for a retry.
    const hash = hashArgs(request)
    const known = opens.get(key)
    if (known !== undefined)
      return known.hash === hash
        ? await known.result
        : remoteFailure(
            "idempotency_conflict",
            "The idempotency key was already used for another open.",
            nextActionFor("idempotency_conflict"),
          )
    const result = openOnce(request, asked, opts)
    opens.set(key, { hash, result })
    const settled = await result
    if (settled.kind === "error" && settled.partial === undefined && settled.uncertain !== true) opens.delete(key)
    return settled
  }

  const openOnce = async (
    request: OpenRequest,
    asked: SessionOpenRequest & LaunchProfile,
    opts?: Opts,
  ): R<OpenResult> => {
    const device = await deviceRow(request.device, opts)
    // This device with no device service: thread_create's local host needs a running engine's extension context, which
    // a client does not have, so the open is local only.
    if (device.kind === "ok" && device.value.self === true && device.value.kind === "local")
      return remoteFailure(
        "local_only",
        "This device has no device service, so a session can only be opened here from inside omo.",
        "Call service.bootstrap to install the device service, then call sessions.open again.",
      )
    if (device.kind === "error") return device
    const made = await core.member(opts, DEADLINES.openEndpoint, true, async (svc) => {
      const outcome = await createRelaySessionHost(legOf(svc).remote, device.value.id).open(asked)
      if (outcome.kind === "error") return modelUnavailable(fromThread(outcome.error), request.model)
      return ok(handleOf(device.value.id, outcome.thread.sessionId))
    })
    if (made.kind === "error") return made
    const result: OpenResult = { thread: made.value, device: device.value }
    if (request.first === undefined) return ok(result)
    const first = await send(
      made.value,
      {
        ...request.first,
        ...(request.idempotency_key === undefined ? {} : { idempotency_key: request.idempotency_key }),
      },
      opts,
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
      const target = targetOf(thread)
      if ("kind" in target) return target
      const listed = await core.sessionsList({ device: target.device }, opts)
      if (listed.kind === "error") return listed
      const row = listed.value.rows.find((candidate) => candidate.thread === thread)
      if (row === undefined)
        return remoteFailure(
          "not_found",
          `Device ${target.device} lists no session ${target.session}.`,
          nextActionFor("not_found"),
          {
            details: { kind: "session" },
          },
        )
      return core.member(opts, DEADLINES.observeRead, false, async (svc) => {
        const state = await engineState(svc, target)
        if (state.kind === "error") return state
        const data = state.value
        const model = isObject(data["model"]) ? data["model"] : {}
        const provider = text(model["provider"])
        const id = text(model["id"])
        const turn = text(data["currentTurnId"])
        const queued = data["pendingMessageCount"]
        const detail: SessionDetail = {
          ...row,
          cwd: text(data["cwd"]) ?? row.path,
          model: provider === undefined || id === undefined ? "" : `${provider}/${id}`,
          reasoning: text(data["thinkingLevel"]) ?? "",
          preset: text(data["permissionPreset"]) ?? "",
          ...(turn === undefined
            ? {}
            : { turn: { id: turn, state: data["isStreaming"] === true ? "running" : "idle" } }),
          pending: {
            dialogs: Array.isArray(data["pendingDialogs"]) ? data["pendingDialogs"].length : 0,
            queued: typeof queued === "number" ? queued : 0,
          },
        }
        return ok(detail)
      })
    },
    read: async (thread, page, opts) => {
      const target = targetOf(thread)
      if ("kind" in target) return target
      return core.member(opts, DEADLINES.observeRead, false, async (svc) => {
        const attached = await svc.attach(target.device, target.session)
        try {
          return ok(
            await attached.read({
              ...(page?.before === undefined ? {} : { before: page.before }),
              ...(page?.tail === undefined ? {} : { tail: page.tail }),
            }),
          )
        } finally {
          await attached.detach()
        }
      })
    },
    // The engine's interrupt record itself (relay-control's body drops the background report InterruptResult carries).
    interrupt: async (thread, opts) => {
      const target = targetOf(thread)
      if ("kind" in target) return target
      return core.member(opts, DEADLINES.drive, true, async (svc) => {
        const { device, session } = target
        const outcome = await legOf(svc).remote.sessions.sessionCommand(device, session, {
          type: "interrupt",
          sessionId: session,
        })
        if (outcome.kind !== "ok") return fromThread(outcomeFailure(outcome, device).error)
        const reply = replyData(outcome.response)
        const turn = text(reply["turnId"])
        return ok({
          thread_id: thread,
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
      ),
    close: async (thread, opts) => {
      const target = targetOf(thread)
      if ("kind" in target) return target
      return core.member(opts, DEADLINES.close, true, async (svc) => {
        const result = await answered(() => closeThread(controlOf(svc, target)))
        if (result.kind === "error") return fromThread(result.error)
        return ok({ closed: "closed" in result && result.closed === true })
      })
    },
    // No layer stores archive state: the listing (device-service-core), the engine (senpi) and the thread tools carry none.
    archive: async () =>
      remoteFailure("unsupported", "No layer stores a session's archive state yet.", nextActionFor("unsupported"), {
        details: { feature: "archive" },
      }),
  }
}
