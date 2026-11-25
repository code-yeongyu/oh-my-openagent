import { AsyncResource } from "node:async_hooks"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { resolveErrorStreakSettings, resolveHomeDir } from "@oh-my-opencode/omo-config-core"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { loadSenpiOmoConfig } from "../config-resolution"
import { returnedAtClose, settleGracefulClose } from "./gateway/graceful-close-returns"
import { SESSION_CONTROL_DELIVERY_TYPE } from "./gateway/constants"
import { loadProvenanceWorkspaces } from "./gateway/provenance-config"
import { registerCreateReceivers } from "./create-receivers"
import {
  controlSessionOf,
  createControlEndpointRegistrant,
  hostInstanceOf,
  hostSocketOf,
  sessionControlOf,
  type ControlEndpointRegistrantOptions,
  type SessionControlActionsPort,
} from "./gateway/registration"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { registerThreadTools, UNKNOWN_CALLER, type ThreadToolSurfaceOptions } from "./tools"
import { createLazyLiveThreadSurface } from "./lazy-live-surface"
import { createDefaultRemoteSurface } from "./remote/default-remote"
import { loadSenpiProjector } from "./remote/senpi-projector"
import { registerRemoteMonitorTargets } from "./remote/lazy-ops"
import { createOmoNativeProductConfig } from "../telemetry/product-identity"
import { defaultThreadStateDirectory, isThreadSocket } from "./live-surface-paths"
import { thisDeviceId } from "./remote/this-device"
import type { AgentEndFacts } from "./run-alerts/error-streak"
import { createRunAlerts, type RunAlertsOptions } from "./run-alerts/run-alerts"
import type { IntakeAdmission } from "./gateway/intake-admission"
import type { SameDeviceWake } from "./gateway/same-device-wake"
import type { ThreadWakeOptions } from "./wake/runtime"
import { ledgerDevice } from "./delivery-ledger"

/**
 * The wake's process-level async scope, captured while senpi imports omo.js. The wake sidecar is first imported
 * from a `session_start` handler or a send, so a scope created there would inherit that session's handle ledger and
 * its shutdown would reclaim the carrier's sockets and timers (the device-service registrant's reason, #13457).
 */
const wakeProcessScope = new AsyncResource("omo-thread-wake-carrier")

/** The files the pre-gateway mailbox kept its queue in (`gateway/legacy-mailbox.ts`). */
const LEGACY_MAILBOX_FILES = ["mailbox.jsonl", "mailbox.json"] as const

export type ThreadComponentOptions = Partial<
  Omit<ThreadToolSurfaceOptions, "callerSessionId" | "callerWorkspaceRoot" | "store">
> & {
  readonly callerSessionId?: () => string
  readonly callerWorkspaceRoot?: () => string
  /** Absent: `pi.session` when the engine has it. `null`: no control endpoint. */
  readonly sessionControl?: SessionControlActionsPort | null
  readonly agentDir?: () => string
  readonly store?: GatewayStore
  readonly controlEndpointTest?: ControlEndpointRegistrantOptions["_test"]
  /** Test seams of the session wake (#13037): the carrier, the consumer and their switches. */
  readonly wake?: ThreadWakeOptions
  /** Test seams of the error-streak alerts (#14430): the clock, this device's id, the webhook client and the retry pause. */
  readonly operatorAlerts?: Pick<RunAlertsOptions, "now" | "device" | "fetch" | "delay">
}

/**
 * `cause`: the newest delivery whose message the model has taken into its context (a send from this
 * run continues its causal root). A delivery admitted but still waiting in a queue is not a cause yet.
 * A `user` or `custom` message after a final answer (an assistant message without a tool call) starts
 * a new group: a prompt typed in the terminal, and equally an extension's message that starts a turn
 * (a delegated task's result, or a `sendUserMessage`).
 */
type RunContext = {
  turn: number
  cause: string | undefined
  chainHop: number
  replyTo: string[]
  replySenders: { session_id: string; name?: string; device?: string }[]
  answered: boolean
}

type EngineMessage = {
  readonly role?: unknown
  readonly customType?: unknown
  readonly details?: unknown
  readonly content?: unknown
}

function messageOf(event: unknown): EngineMessage | undefined {
  const message = (event as { readonly message?: unknown } | undefined)?.message
  return typeof message === "object" && message !== null ? (message as EngineMessage) : undefined
}

type DeliveryDetails = {
  readonly delivery_id?: unknown
  readonly chain_count?: unknown
  readonly sender?: {
    readonly kind?: unknown
    readonly session_id?: unknown
    readonly name?: unknown
    readonly platform?: unknown
  }
}

/** senpi `external-admission.js` `deliveryIdOf`: the delivery a `session_control_delivery` message carries. */
function deliveryOf(message: EngineMessage):
  | {
      readonly id: string
      readonly chainCount: number
      readonly agentSender: string | undefined
      readonly senderName: string | undefined
      readonly device: string | undefined
      readonly rpcInput: boolean
    }
  | "malformed"
  | undefined {
  if (message.role !== "custom" || message.customType !== SESSION_CONTROL_DELIVERY_TYPE) return undefined
  const details = (message.details ?? undefined) as DeliveryDetails | undefined
  const id = details?.delivery_id
  // A delivery message without a string id is malformed: after an answer it starts a new group with nobody approved,
  // and it never passes as a turn the engine started, which would keep the earlier group's allowance (#13056).
  if (typeof id !== "string") return "malformed"
  const count = details?.chain_count
  return {
    id,
    chainCount: typeof count === "number" && Number.isSafeInteger(count) && count >= 1 ? count : 0,
    agentSender:
      details?.sender?.kind === "agent" && typeof details.sender.session_id === "string"
        ? details.sender.session_id
        : undefined,
    senderName:
      typeof details?.sender?.name === "string" && details.sender.name.trim() !== ""
        ? details.sender.name.trim()
        : undefined,
    device: ledgerDevice(id),
    // senpi admits a `prompt`/`steer`/`follow_up` sent over the session's RPC socket as this same message, under the
    // client's `clientMessageId` and with this sender it stamps itself (`session-control-input-commands.js`).
    rpcInput: details?.sender?.kind === "external" && details.sender.platform === "rpc",
  }
}

function callsTools(message: EngineMessage): boolean {
  return (
    Array.isArray(message.content) &&
    message.content.some((part) => (part as { readonly type?: unknown } | null)?.type === "toolCall")
  )
}

/** A final answer was given: the next input starts a new group, and nothing of the earlier one survives. */
function startGroup(run: RunContext): void {
  run.cause = undefined
  run.replyTo = []
  run.replySenders = []
  run.chainHop = 0
  run.answered = false
}

/**
 * Decision 0027 section 6 (#13042): the reply allowance belongs to the consumed delivery and lasts for the work that
 * delivery started - the consuming turn and every later turn the engine starts on its own (a reminder, a goal
 * continuation, a monitor wake: a custom message that is no delivery). It ends when a new message starts work after
 * a final answer: a person's message (role user, which is also how a loop tick or a schedule arrives, so those end
 * it too) or any delivery, whose own sender the new group then holds. A delivery that joins running work adds its
 * sender. An engine-started message that arrives after the answer and before the settle keeps the allowance.
 * The same-account bound is not enforced here: a delivery reaches this component only after the engine's admission
 * accepted it for this account, so the allowance a consumed delivery grants rests on that admission (#13044, #13056).
 */
function noteInput(run: RunContext, message: EngineMessage): void {
  if (message.role !== "user" && message.role !== "custom") return
  const delivery = deliveryOf(message)
  if (delivery === "malformed") {
    // Like a delivery it ends an answered group (nothing of the earlier group survives) and, unlike a valid one, adds
    // no sender; while work is running it joins it as a valid delivery would, adding nothing and keeping the hop.
    if (run.answered) startGroup(run)
    return
  }
  if (message.role === "custom" && delivery === undefined) {
    run.answered = false
    return
  }
  if (run.answered) startGroup(run)
  if (delivery === undefined) return
  // RPC input is typed input, never a delivery this session received: its id is the client's to choose, so it is no
  // cause and no reply sender, and a send from its run starts a new causal root (#12317).
  if (delivery.rpcInput) return
  // Every consumed delivery is the cause of the run's next send, on either transport (decision 0027 section 3); one no row
  // here holds starts a new root there and its hop count continues the chain (K8).
  run.cause = delivery.id
  run.chainHop = Math.max(run.chainHop, delivery.chainCount)
  if (delivery.agentSender !== undefined && !run.replyTo.includes(delivery.agentSender))
    run.replyTo.push(delivery.agentSender)
  if (
    delivery.agentSender !== undefined &&
    !run.replySenders.some(
      (s) => s.session_id === delivery.agentSender && s.device === delivery.device && s.name === delivery.senderName,
    )
  )
    run.replySenders.push({
      session_id: delivery.agentSender,
      ...(delivery.senderName === undefined ? {} : { name: delivery.senderName }),
      ...(delivery.device === undefined ? {} : { device: delivery.device }),
    })
}

/** senpi's ask_user tool per model family (`ask-user/family.js` `TOOL_NAMES`) and the flag that makes it wait for the answer. */
const ASK_USER_WAIT_FLAGS: Readonly<Record<string, string>> = {
  ask_user_question: "waitForAnswer",
  request_user_input: "wait_for_answer",
}

/**
 * The tool call of a question the session waits on: an ask_user call whose wait flag is set holds
 * the run inside that tool call until the user answers, so a steer has no turn to enter. A question
 * that does not wait returns at once and blocks nothing.
 */
function waitingQuestionCallOf(event: unknown): string | undefined {
  const { toolCallId, toolName, args } = (event ?? {}) as {
    readonly toolCallId?: unknown
    readonly toolName?: unknown
    readonly args?: unknown
  }
  if (typeof toolCallId !== "string" || typeof toolName !== "string") return undefined
  const flag = ASK_USER_WAIT_FLAGS[toolName]
  return flag !== undefined && (args as Record<string, unknown> | null | undefined)?.[flag] === true
    ? toolCallId
    : undefined
}

/** senpi's `session_shutdown { closed: true }`: a graceful close ended the session on request (omo#14313). */
const closedOnRequest = (event: unknown): boolean =>
  typeof event === "object" && event !== null && (event as { readonly closed?: unknown }).closed === true

function durableIdOf(eventCtx: unknown): string | undefined {
  const manager = (eventCtx as { readonly sessionManager?: { readonly getSessionId?: () => unknown } } | undefined)
    ?.sessionManager
  const id = typeof manager?.getSessionId === "function" ? manager.getSessionId() : undefined
  return typeof id === "string" && id.length > 0 ? id : undefined
}

/**
 * Registers the session's control endpoint so other sessions can reach it through the gateway: the
 * registration is what creates the terminal's `tui` endpoint (or wires the drain on a host session),
 * and the drain is the only path a delivery takes into this session. On an engine without
 * `pi.session` nothing is registered and nothing else changes. Registration runs off the
 * `session_start` path (the inbox watch arms asynchronously); shutdown waits for it and disposes
 * the endpoint before the store, because senpi's clean exit asks `isSessionReferenced` then.
 */
function registerControlEndpoint(
  pi: SenpiExtensionAPI,
  ctx: ComponentContext,
  options: ThreadComponentOptions,
  store: GatewayStore,
  agentDir: () => string,
  admitIntake: NonNullable<ControlEndpointRegistrantOptions["admitIntake"]>,
) {
  const control = options.sessionControl === undefined ? sessionControlOf(pi) : (options.sessionControl ?? undefined)
  if (control === undefined) return undefined
  const runtimeInstance = hostInstanceOf(pi)
  const registrant = createControlEndpointRegistrant({
    control,
    agentDir,
    store,
    admitIntake,
    ...(runtimeInstance === undefined ? {} : { runtimeInstance }),
    log: (line) => ctx.logger.warn(line),
    ...(options.controlEndpointTest === undefined ? {} : { _test: options.controlEndpointTest }),
  })
  pi.on("session_start", (_event, eventCtx) => {
    const session = controlSessionOf(eventCtx)
    if (session === undefined) return
    void registrant
      .start(session)
      .catch((error: unknown) =>
        ctx.logger.warn(
          `thread gateway: control endpoint registration failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
  })
  // A session thread_create opened runs on a host, so its initial skills ride with the control endpoint.
  registerCreateReceivers(pi, ctx)
  pi.on("session_before_compact", () => registrant.noteCompaction(true))
  pi.on("session_compact", () => registrant.noteCompaction(false))
  // A steer into a session waiting on a question is `not_steerable` (`decision.ts`): the answer comes
  // through the question itself, never as a delivery.
  pi.on("tool_execution_start", (event) => {
    const id = waitingQuestionCallOf(event)
    if (id !== undefined) registrant.noteQuestion(id, true)
  })
  pi.on("tool_execution_end", (event) => {
    const id = (event as { readonly toolCallId?: unknown } | undefined)?.toolCallId
    if (typeof id === "string") registrant.noteQuestion(id, false)
  })
  return registrant
}

/**
 * Component registration follows task's factory/register pattern. Production constructs a client
 * for the existing Senpi multi-session socket; an injected host remains available as a test seam.
 * One gateway store serves the tools' receipts and the control endpoint.
 */
export function createThreadComponent(options: ThreadComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "thread",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const host = options.host ?? createLazyLiveThreadSurface(pi)
      const stateDirectory = options.stateDirectory ?? defaultThreadStateDirectory(pi)
      const agentDir = options.agentDir ?? (() => resolveAgentHome({ env: process.env }))
      const runtimeInstance = hostInstanceOf(pi)
      // The pre-gateway `thread_send` mailbox of this workspace: its undelivered items are imported
      // into the store once, when this session starts and the mailbox still exists on disk.
      const legacyMailbox = join(stateDirectory, "mailbox")
      const callerWorkspaceRoot = options.callerWorkspaceRoot ?? (() => pi.cwd ?? process.cwd())
      const onProvenanceWarning = (message: string) => ctx.logger.warn(`thread gateway: ${message}`)
      const remote =
        options.remote ??
        createDefaultRemoteSurface({
          version: createOmoNativeProductConfig().packageVersion,
          // One surface serves every session of this engine, so its client acts as the engine's host instance: engine-wide,
          // never per session. The thread surface calls only service.status and devices.list, which never read it.
          sender: { kind: "session", id: runtimeInstance ?? UNKNOWN_CALLER },
          log: (line) => ctx.logger.warn(line),
          permissionPreset: () => pi.getPermissionPreset?.(),
          loadProjector: loadSenpiProjector,
        })
      registerRemoteMonitorTargets(pi, remote)
      const store =
        options.store ??
        createGatewayStore({
          agentDir: agentDir(),
          legacyMailboxDirectories: [legacyMailbox],
          ...(runtimeInstance === undefined ? {} : { runtimeInstance }),
        })
      // Every store open retries an unreadable legacy mailbox, and an idle store reopens its worker on
      // the next call, so the same failure would repeat each time: it is reported once per session.
      const reportedInvalidMailboxes = new Set<string>()
      store.onEvent((event) => {
        if (event.kind === "legacy_mailbox_invalid" && !reportedInvalidMailboxes.has(event.directory)) {
          reportedInvalidMailboxes.add(event.directory)
          ctx.logger.warn(
            `thread gateway: the legacy thread mailbox ${event.directory} could not be read and was not imported (it is retried each time the store opens): ${event.error}`,
          )
        }
        if (event.kind === "legacy_mailbox_skipped")
          ctx.logger.warn(
            `thread gateway: ${event.items.length} legacy thread mailbox item(s) in ${event.directory} name no session id and were not imported: ${event.items.map((item) => `#${item.message_seq} -> ${JSON.stringify(item.target)}`).join(", ")}`,
          )
      })
      const run: RunContext = {
        turn: 0,
        cause: undefined,
        chainHop: 0,
        replyTo: [],
        replySenders: [],
        answered: true,
      }
      const sessionsDirectory = options.sessionsDirectory ?? (() => join(agentDir(), "sessions"))
      // The running wake is the process's (one per agent directory, latched), so it opens its own store and never
      // borrows this component's: this session's shutdown disposes that one, and every later wake would fail on it.
      // Its worker still retires when idle, since the carrier arms its sweep only while the wake table holds a row
      // (design A3.1.4).
      const wakeOptions: ThreadWakeOptions = { ...options.wake }
      const warn = (line: string) => ctx.logger.warn(line)
      // The wake's runtime (the carrier and its host connection, the delivery consumer and its device-service client)
      // lives in its own sidecar (#omo-wake-runtime -> extensions/omo-wake.js): the main bundle carries only the lazy
      // shells below, and a load that fails answers as if no wake exists rather than taking the send down with it.
      const wakeRuntime = (): Promise<typeof import("#omo-wake-runtime")> => import("#omo-wake-runtime")
      let sameDeviceBuilt: Promise<SameDeviceWake> | undefined
      const sameDeviceWake: SameDeviceWake = {
        afterSend: async (result) => {
          sameDeviceBuilt ??= wakeRuntime().then((module) =>
            module.createSameDeviceWake({
              options: wakeOptions,
              store,
              agentDir,
              sessionsDirectory,
              cwd: callerWorkspaceRoot,
              warn,
            }),
          )
          return await sameDeviceBuilt.then(
            (wake) => wake.afterSend(result),
            () => result,
          )
        },
      }
      let admissionBuilt: Promise<(device: string) => Promise<IntakeAdmission>> | undefined
      const wakeAdmission = async (device: string): Promise<IntakeAdmission> => {
        admissionBuilt ??= wakeRuntime().then((module) => module.intakeAdmission(wakeOptions, agentDir))
        return await admissionBuilt.then(
          (ask) => ask(device),
          () => "unknown",
        )
      }
      const tools = registerThreadTools(
        pi,
        {
          host,
          stateDirectory,
          store,
          env: options.env,
          loadProvenanceWorkspaces,
          onProvenanceWarning,
          diskSessions: options.diskSessions,
          sessionsDirectory,
          ensureHost: options.ensureHost,
          sameDeviceWake,
          callerSessionId: options.callerSessionId ?? (() => UNKNOWN_CALLER),
          callerWorkspaceRoot,
          callerTurnId: () => (run.turn === 0 ? undefined : `turn-${run.turn}`),
          callerName: () => pi.getSessionName?.(),
          callerCause: () => run.cause,
          callerChainHop: () => run.chainHop,
          callerReplyTargets: () => [...run.replyTo],
          callerReplySenders: () => [...run.replySenders],
          remote,
        },
        (line) => ctx.logger.warn(line),
      )
      const alertEnv = options.env ?? process.env
      const alerts = createRunAlerts({
        // User layer only: loading from $HOME walks no project layer, so a cloned repo's .omo/omo.json cannot pick the
        // env var a webhook URL is read from, or add threads that receive messages sent as this session.
        settings: () =>
          resolveErrorStreakSettings(loadSenpiOmoConfig({ cwd: resolveHomeDir(alertEnv), env: alertEnv }).config),
        env: alertEnv,
        now: Date.now,
        sendAs: tools.sendAs,
        sessionName: () => pi.getSessionName?.(),
        device: async () => {
          const here = await thisDeviceId(remote)
          return "device" in here ? here.device : undefined
        },
        log: { info: (line) => ctx.logger.info(line), warn: (line) => ctx.logger.warn(line) },
        ...options.operatorAlerts,
      })
      const registrant = registerControlEndpoint(pi, ctx, options, store, agentDir, wakeAdmission)
      let legacyImportStarted = false
      const importLegacyMailbox = async (): Promise<void> => {
        if (legacyImportStarted || !LEGACY_MAILBOX_FILES.some((file) => existsSync(join(legacyMailbox, file)))) return
        legacyImportStarted = true
        try {
          const imported = await store.legacyMigrated()
          if (imported > 0)
            ctx.logger.info(
              `thread gateway: imported ${imported} undelivered message(s) from the legacy thread mailbox ${legacyMailbox}`,
            )
        } catch (error) {
          ctx.logger.warn(
            `thread gateway: the legacy thread mailbox was not imported: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      const startWake = (eventCtx: unknown): void => {
        void wakeRuntime()
          .then((module) =>
            module.startWakeAtSession(eventCtx, {
              options: wakeOptions,
              agentDir,
              sessionsDirectory,
              cwd: callerWorkspaceRoot,
              engineVersion: pi.hostVersion,
              ensureHost: options.ensureHost,
              warn,
              scope: wakeProcessScope,
            }),
          )
          .catch((error: unknown) =>
            warn(
              `thread gateway: the session wake runtime could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
            ),
          )
      }
      // The operator daemon is the device's session host: it starts the wake, and with it the delivery consumer, as
      // soon as it loads omo - a `warm` (`omo daemon run` sends one after its ensure) or its first open - so a host the
      // device service cold-starts declares its consumer with no session running (#13037 cold wake).
      const hostSocket = hostSocketOf(pi)
      if (hostSocket !== undefined && isThreadSocket(hostSocket, wakeOptions.env ?? process.env))
        startWake({ mode: "rpc" })
      pi.on("session_start", (_event, eventCtx) => {
        startWake(eventCtx)
        void importLegacyMailbox()
      })
      pi.on("agent_start", () => {
        run.turn++
      })
      pi.on("message_start", (event) => {
        const message = messageOf(event)
        if (message !== undefined) noteInput(run, message)
      })
      pi.on("message_end", (event) => {
        const message = messageOf(event)
        if (message?.role === "assistant") run.answered = !callsTools(message)
      })
      pi.on("agent_end", (event, eventCtx) => {
        const durableId = durableIdOf(eventCtx)
        if (durableId !== undefined) alerts.agentEnd(durableId, event as AgentEndFacts)
      })
      pi.on("agent_settled", (_event, eventCtx) => {
        // A settle alone keeps the consumed delivery's senders, hop and cause (#13042): the next input decides whether
        // the work continues (noteInput).
        run.answered = true
        const durableId = durableIdOf(eventCtx)
        if (durableId !== undefined) alerts.settled(durableId)
      })
      pi.on("session_shutdown", async (event, eventCtx) => {
        const endedId = durableIdOf(eventCtx)
        if (endedId !== undefined) alerts.ended(endedId)
        tools.dispose()
        await registrant
          ?.stop()
          .catch((error: unknown) =>
            ctx.logger.warn(
              `thread gateway: control endpoint teardown failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          )
        const durableId = durableIdOf(eventCtx)
        if (closedOnRequest(event) && durableId !== undefined)
          await settleGracefulClose(store, durableId, returnedAtClose(eventCtx)).catch((error: unknown) =>
            ctx.logger.warn(
              `thread gateway: the graceful close's unread messages were not answered: ${error instanceof Error ? error.message : String(error)}`,
            ),
          )
        if (options.store === undefined) await store.dispose().catch(() => undefined)
        // The surface this component built holds the device-service connection a thread tool opened; left open it keeps
        // the engine alive after its last session ends (#14054: `omo -p` never exited). A later call reconnects lazily.
        if (options.remote === undefined) await remote.sessions.close?.().catch(() => undefined)
      })
    },
  }
}
