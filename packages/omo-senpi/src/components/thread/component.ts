import { existsSync } from "node:fs"
import { join } from "node:path"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { loadSenpiOmoConfig } from "../config-resolution"
import { modelProfileChoice } from "./model-control"
import { createCompletionTracker, type AgentEndFacts } from "./gateway/completion"
import { SESSION_CONTROL_DELIVERY_TYPE } from "./gateway/constants"
import { gatewayDatabasePath } from "./gateway/paths"
import { controlSessionOf, createControlEndpointRegistrant, hostInstanceOf, sessionControlOf, type ControlEndpointRegistrantOptions, type SessionControlActionsPort } from "./gateway/registration"
import type { ModelRef, ModelSelectSource } from "./gateway/session-models"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { registerThreadTools, UNKNOWN_CALLER, type ThreadToolSurfaceOptions } from "./tools"
import { createLiveThreadSurface, defaultThreadStateDirectory } from "./live-surface"

/**
 * The longest the `agent_settled` handler waits for an armed completion's store write. senpi waits
 * for `agent_settled` handlers before the session goes idle, so the store (whose write lock another
 * process may hold) never holds the settle: past this bound the write continues in the background,
 * retried after the store's busy timeout while another process keeps the lock, and logged.
 */
export const COMPLETION_SETTLE_WAIT_MS = 250

/** The files the pre-gateway mailbox kept its queue in (`gateway/legacy-mailbox.ts`). */
const LEGACY_MAILBOX_FILES = ["mailbox.jsonl", "mailbox.json"] as const

async function waitAtMost(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, ms) })])
  } finally {
    clearTimeout(timer)
  }
}

export type ThreadComponentOptions = Partial<Omit<ThreadToolSurfaceOptions, "callerSessionId" | "callerWorkspaceRoot" | "store" | "onCompletionArmed">> & {
  readonly callerSessionId?: () => string
  readonly callerWorkspaceRoot?: () => string
  /** Absent: `pi.session` when the engine has it. `null`: no control endpoint. */
  readonly sessionControl?: SessionControlActionsPort | null
  readonly agentDir?: () => string
  readonly store?: GatewayStore
  readonly controlEndpointTest?: ControlEndpointRegistrantOptions["_test"]
}

/**
 * `cause`: the newest delivery whose message the model has taken into its context (a send from this
 * run continues its causal root). A delivery admitted but still waiting in a queue is not a cause yet.
 * `consumed`: the deliveries the model has taken into its context since its last final answer (an
 * assistant message without a tool call), read from the engine's own `message_start` of each
 * delivery's custom message. senpi drains a queued follow-up after that answer and before
 * `agent_settled`, so the follow-up starts a new group: a report without `binding_id` goes to the
 * binding of the message the current answer is for, never to the thread the session started on.
 * Any other `user` or `custom` message after a final answer also starts a new group: a prompt typed
 * in the terminal, and equally an extension's message that starts a turn (a delegated task's result,
 * or a `sendUserMessage`), which keeps none of the bound messages taken up before it.
 * `local`: a `user` message is in the group. senpi 2026.9.30 gives a prompt, steer or follow-up typed
 * in the terminal and an extension's `sendUserMessage` (a non-blocking ask_user answer, a stop-hook
 * follow-up, `/remember`) the same shape, with no field naming its source, so every one counts as
 * typed input. Together with a bound message the answer then has two possible origins, and while the
 * session has another outbound binding a report without `binding_id` is refused rather than sent to
 * the bound thread (`store-relay-ops.ts` `reportBindingDefault`); with that thread's binding as the
 * only one it goes there. Never a misroute: an input the session cannot attribute makes an implicit
 * report refuse when several bindings exist.
 */
type RunContext = { turn: number; cause: string | undefined; consumed: string[]; local: boolean; answered: boolean }

type EngineMessage = { readonly role?: unknown; readonly customType?: unknown; readonly details?: unknown; readonly content?: unknown }

function messageOf(event: unknown): EngineMessage | undefined {
  const message = (event as { readonly message?: unknown } | undefined)?.message
  return typeof message === "object" && message !== null ? (message as EngineMessage) : undefined
}

/** senpi `external-admission.js` `deliveryIdOf`: the delivery a `session_control_delivery` message carries. */
function deliveryIdOf(message: EngineMessage): string | undefined {
  if (message.role !== "custom" || message.customType !== SESSION_CONTROL_DELIVERY_TYPE) return undefined
  const id = (message.details as { readonly delivery_id?: unknown } | null | undefined)?.delivery_id
  return typeof id === "string" ? id : undefined
}

function callsTools(message: EngineMessage): boolean {
  return Array.isArray(message.content) && message.content.some((part) => (part as { readonly type?: unknown } | null)?.type === "toolCall")
}

function noteInput(run: RunContext, message: EngineMessage): void {
  if (message.role !== "user" && message.role !== "custom") return
  if (run.answered) {
    run.consumed = []
    run.local = false
    run.answered = false
  }
  if (message.role === "user") run.local = true
  const deliveryId = deliveryIdOf(message)
  if (deliveryId === undefined) return
  run.cause = deliveryId
  if (!run.consumed.includes(deliveryId)) run.consumed.push(deliveryId)
}

/** senpi's ask_user tool per model family (`ask-user/family.js` `TOOL_NAMES`) and the flag that makes it wait for the answer. */
const ASK_USER_WAIT_FLAGS: Readonly<Record<string, string>> = { ask_user_question: "waitForAnswer", request_user_input: "wait_for_answer" }

/**
 * The tool call of a question the session waits on: an ask_user call whose wait flag is set holds
 * the run inside that tool call until the user answers, so a steer has no turn to enter. A question
 * that does not wait returns at once and blocks nothing.
 */
function waitingQuestionCallOf(event: unknown): string | undefined {
  const { toolCallId, toolName, args } = (event ?? {}) as { readonly toolCallId?: unknown; readonly toolName?: unknown; readonly args?: unknown }
  if (typeof toolCallId !== "string" || typeof toolName !== "string") return undefined
  const flag = ASK_USER_WAIT_FLAGS[toolName]
  return flag !== undefined && (args as Record<string, unknown> | null | undefined)?.[flag] === true ? toolCallId : undefined
}

const MODEL_SELECT_SOURCES: readonly ModelSelectSource[] = ["set", "cycle", "restore", "fallback", "fallback-revert"]

function modelRefOf(value: unknown): ModelRef | null {
  const { provider, id } = (value ?? {}) as { readonly provider?: unknown; readonly id?: unknown }
  return typeof provider === "string" && typeof id === "string" ? { provider, id } : null
}

/** senpi `model_select`: the new model, the one it replaced, and why the engine switched. */
function modelSelectOf(event: unknown): { readonly to: ModelRef; readonly from: ModelRef | null; readonly source: ModelSelectSource } | undefined {
  const { model, previousModel, source } = (event ?? {}) as { readonly model?: unknown; readonly previousModel?: unknown; readonly source?: unknown }
  const to = modelRefOf(model)
  const known = MODEL_SELECT_SOURCES.find((candidate) => candidate === source)
  return to === null || known === undefined ? undefined : { to, from: modelRefOf(previousModel), source: known }
}

/** The provider error of a failed assistant message (`stopReason: "error"`): what a fallback switch that follows it reports. */
function providerErrorOf(message: EngineMessage): string | undefined {
  const { stopReason, errorMessage } = message as { readonly stopReason?: unknown; readonly errorMessage?: unknown }
  return stopReason === "error" && typeof errorMessage === "string" && errorMessage.length > 0 ? errorMessage : undefined
}

function durableIdOf(eventCtx: unknown): string | undefined {
  const manager = (eventCtx as { readonly sessionManager?: { readonly getSessionId?: () => unknown } } | undefined)?.sessionManager
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
function registerControlEndpoint(pi: SenpiExtensionAPI, ctx: ComponentContext, options: ThreadComponentOptions, store: GatewayStore, agentDir: () => string, onCommandWake: (durableId: string) => Promise<void>) {
  const control = options.sessionControl === undefined ? sessionControlOf(pi) : (options.sessionControl ?? undefined)
  if (control === undefined) return undefined
  const runtimeInstance = hostInstanceOf(pi)
  const registrant = createControlEndpointRegistrant({
    control,
    agentDir,
    store,
    onCommandWake,
    ...(runtimeInstance === undefined ? {} : { runtimeInstance }),
    log: (line) => ctx.logger.warn(line),
    ...(options.controlEndpointTest === undefined ? {} : { _test: options.controlEndpointTest }),
  })
  pi.on("session_start", (_event, eventCtx) => {
    const session = controlSessionOf(eventCtx)
    if (session === undefined) return
    void registrant.start(session).catch((error: unknown) => ctx.logger.warn(`thread gateway: control endpoint registration failed: ${error instanceof Error ? error.message : String(error)}`))
  })
  pi.on("session_before_compact", () => registrant.noteCompaction(true))
  pi.on("session_compact", () => registrant.noteCompaction(false))
  // A steer into a session waiting on a question is `not_steerable` (`decision.ts`): the answer comes
  // through the question itself (`thread_answer`), never as a delivery.
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
 * One gateway store serves the tools (receipts, bindings, outbox) and the control endpoint; a
 * completion armed through `thread_report` is written when the session settles, never at an
 * `agent_end`, and a session that armed nothing never touches the store when it settles.
 */
export function createThreadComponent(options: ThreadComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "thread",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const host = options.host ?? createLiveThreadSurface(pi)
      const stateDirectory = options.stateDirectory ?? defaultThreadStateDirectory(pi)
      const agentDir = options.agentDir ?? (() => resolveAgentHome({ env: process.env }))
      const runtimeInstance = hostInstanceOf(pi)
      // The pre-gateway `thread_send` mailbox of this workspace: its undelivered items are imported
      // into the store once, when this session starts and the mailbox still exists on disk.
      const legacyMailbox = join(stateDirectory, "mailbox")
      const store = options.store ?? createGatewayStore({ agentDir: agentDir(), legacyMailboxDirectories: [legacyMailbox], ...(runtimeInstance === undefined ? {} : { runtimeInstance }) })
      store.onEvent((event) => {
        if (event.kind === "legacy_mailbox_invalid") ctx.logger.warn(`thread gateway: the legacy thread mailbox ${event.directory} could not be read and was not imported (retried at the next start): ${event.error}`)
        if (event.kind === "legacy_mailbox_skipped") ctx.logger.warn(`thread gateway: ${event.items.length} legacy thread mailbox item(s) in ${event.directory} name no session id and were not imported: ${event.items.map((item) => `#${item.message_seq} -> ${JSON.stringify(item.target)}`).join(", ")}`)
      })
      const run: RunContext = { turn: 0, cause: undefined, consumed: [], local: false, answered: true }
      const completions = createCompletionTracker((durableId, outcome, throughArmSeq) => store.emitCompletions({ now: store.now(), session_durable_id: durableId, outcome, through_arm_seq: throughArmSeq }), {
        retryAfterMs: () => store.busyTimeoutMs,
        onWriteFailed: (error, retrying) =>
          ctx.logger.warn(retrying
            ? `thread gateway: completion report not written yet, retrying in ${store.busyTimeoutMs} ms: ${error instanceof Error ? error.message : String(error)}`
            : `thread gateway: completion reports were not written: ${error instanceof Error ? error.message : String(error)}`),
      })
      const tools = registerThreadTools(pi, {
        host,
        stateDirectory,
        store,
        diskSessions: options.diskSessions,
        sessionsDirectory: options.sessionsDirectory ?? (() => join(agentDir(), "sessions")),
        ensureHost: options.ensureHost,
        callerSessionId: options.callerSessionId ?? (() => UNKNOWN_CALLER),
        callerWorkspaceRoot: options.callerWorkspaceRoot ?? (() => pi.cwd ?? process.cwd()),
        callerTurnId: () => (run.turn === 0 ? undefined : `turn-${run.turn}`),
        callerCause: () => run.cause,
        callerRunDeliveries: () => [...run.consumed],
        callerRunHasLocalInput: () => run.local,
        onCompletionArmed: (durableId, armSeq) => completions.arm(durableId, armSeq),
        // #9425: thread_create with no model resolves from the same model_profile the session-start component applies.
        modelProfile: options.modelProfile ?? (() => modelProfileChoice(loadSenpiOmoConfig({ cwd: pi.cwd ?? process.cwd() }).config)),
      })
      // A durable arm this runtime did not make itself - left by an earlier runtime (a restart, or a
      // crash before its write), or made by another process (`omo thread report ... completion`) - is
      // picked up at session_start and on a `wake` command, and written at this session's next settle.
      // Only a store that already exists is read, and the read takes no write lock.
      const pickUpArms = async (durableId: string): Promise<void> => {
        if (!existsSync(gatewayDatabasePath(agentDir()))) return
        try {
          const latest = await store.latestCompletionArm(durableId)
          if (latest !== null) completions.arm(durableId, latest)
        } catch (error) {
          ctx.logger.warn(`thread gateway: pending completion arms were not read: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      const registrant = registerControlEndpoint(pi, ctx, options, store, agentDir, pickUpArms)
      let legacyImportStarted = false
      const importLegacyMailbox = async (): Promise<void> => {
        if (legacyImportStarted || !LEGACY_MAILBOX_FILES.some((file) => existsSync(join(legacyMailbox, file)))) return
        legacyImportStarted = true
        try {
          const imported = await store.legacyMigrated()
          if (imported > 0) ctx.logger.info(`thread gateway: imported ${imported} undelivered message(s) from the legacy thread mailbox ${legacyMailbox}`)
        } catch (error) {
          ctx.logger.warn(`thread gateway: the legacy thread mailbox was not imported: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      pi.on("session_start", (_event, eventCtx) => {
        void importLegacyMailbox()
        const durableId = durableIdOf(eventCtx)
        if (durableId !== undefined) void pickUpArms(durableId)
      })
      pi.on("agent_start", () => {
        run.turn++
      })
      pi.on("message_start", (event) => {
        const message = messageOf(event)
        if (message !== undefined) noteInput(run, message)
      })
      let lastProviderError: string | undefined
      pi.on("message_end", (event) => {
        const message = messageOf(event)
        if (message?.role !== "assistant") return
        run.answered = !callsTools(message)
        lastProviderError = providerErrorOf(message)
      })
      // #9425: the record of a session the gateway created or re-modelled follows the engine's own
      // switches, and a fallback switch is written as a milestone to the session's bindings. Only a store
      // that already exists is touched, and the switch waits for the write at most the settle bound.
      pi.on("model_select", async (event, eventCtx) => {
        const durableId = durableIdOf(eventCtx)
        const select = modelSelectOf(event)
        if (durableId === undefined || select === undefined || select.source === "restore" || !existsSync(gatewayDatabasePath(agentDir()))) return
        const thinking = (pi as { readonly getThinkingLevel?: () => unknown }).getThinkingLevel?.()
        const written = store.observeModelSelect({
          now: store.now(),
          durable_id: durableId,
          ...select,
          thinking_level: typeof thinking === "string" ? thinking : null,
          reason: select.source === "fallback" ? (lastProviderError ?? null) : null,
        }).then(() => undefined, (error: unknown) => ctx.logger.warn(`thread gateway: the model switch to ${select.to.provider}/${select.to.id} was not recorded: ${error instanceof Error ? error.message : String(error)}`))
        await waitAtMost(written, COMPLETION_SETTLE_WAIT_MS)
      })
      pi.on("thinking_level_select", (event, eventCtx) => {
        const durableId = durableIdOf(eventCtx)
        const level = (event as { readonly level?: unknown } | undefined)?.level
        if (durableId === undefined || typeof level !== "string" || !existsSync(gatewayDatabasePath(agentDir()))) return
        void store.updateSessionThinking({ now: store.now(), durable_id: durableId, thinking_level: level }).catch((error: unknown) => ctx.logger.warn(`thread gateway: the thinking level ${level} was not recorded: ${error instanceof Error ? error.message : String(error)}`))
      })
      pi.on("agent_end", (event, eventCtx) => {
        const durableId = durableIdOf(eventCtx)
        if (durableId !== undefined) completions.agentEnd(durableId, event as AgentEndFacts)
      })
      pi.on("agent_settled", async (_event, eventCtx) => {
        const durableId = durableIdOf(eventCtx)
        run.cause = undefined
        run.consumed = []
        run.local = false
        run.answered = true
        if (durableId === undefined) return
        // A failed write is reported (and retried) by the tracker's onWriteFailed.
        await waitAtMost(completions.settled(durableId).then(() => undefined, () => undefined), COMPLETION_SETTLE_WAIT_MS)
      })
      pi.on("session_shutdown", async () => {
        completions.dispose()
        tools.dispose()
        await registrant?.stop().catch((error: unknown) => ctx.logger.warn(`thread gateway: control endpoint teardown failed: ${error instanceof Error ? error.message : String(error)}`))
        if (options.store === undefined) await store.dispose().catch(() => undefined)
      })
    },
  }
}
