import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { createCompletionTracker, type AgentEndFacts } from "./gateway/completion"
import { controlSessionOf, createControlEndpointRegistrant, hostInstanceOf, sessionControlOf, type ControlEndpointRegistrantOptions, type SessionControlActionsPort } from "./gateway/registration"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { registerThreadTools, UNKNOWN_CALLER, type ThreadToolSurfaceOptions } from "./tools"
import { createLiveThreadSurface, defaultThreadStateDirectory } from "./live-surface"

/**
 * SESSION GATEWAY SEND SWITCH (todo 13 -> todo 10). While false, `thread_send` / `thread_handoff`
 * keep the mailbox's `prompt` path: the senpi release that ships `wake`, `admitExternalMessage` and
 * the control endpoint is not adopted yet, and a gateway-only send would leave every delivery
 * `queued_offline` on today's runtime. Todo 10's adoption commit sets it to true; the wiring commit
 * after it deletes this constant, the `sendThroughGateway` option, the mailbox branch of
 * `tools.ts` `deliver`, `mailbox.ts`, `mailbox-journal*.ts` and the file receipts in `receipts.ts`.
 * It is a code switch on purpose, not a setting: the gateway has no user-facing flag.
 */
export const THREAD_SENDS_THROUGH_GATEWAY: boolean = false

export type ThreadComponentOptions = Partial<Omit<ThreadToolSurfaceOptions, "callerSessionId" | "callerWorkspaceRoot" | "store">> & {
  readonly callerSessionId?: () => string
  readonly callerWorkspaceRoot?: () => string
  /** Absent: `pi.session` when the engine has it. `null`: no control endpoint. */
  readonly sessionControl?: SessionControlActionsPort | null
  readonly agentDir?: () => string
  readonly store?: GatewayStore
  readonly controlEndpointTest?: ControlEndpointRegistrantOptions["_test"]
}

type RunContext = { turn: number; cause: string | undefined }

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
function registerControlEndpoint(pi: SenpiExtensionAPI, ctx: ComponentContext, options: ThreadComponentOptions, store: GatewayStore, agentDir: () => string, run: RunContext) {
  const control = options.sessionControl === undefined ? sessionControlOf(pi) : (options.sessionControl ?? undefined)
  if (control === undefined) return undefined
  const runtimeInstance = hostInstanceOf(pi)
  const registrant = createControlEndpointRegistrant({
    control,
    agentDir,
    store,
    onAdmitted: (_durableId, deliveryId) => {
      run.cause = deliveryId
    },
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
  return registrant
}

/**
 * Component registration follows task's factory/register pattern. Production constructs a client
 * for the existing Senpi multi-session socket; an injected host remains available as a test seam.
 * One gateway store serves the tools (receipts, bindings, outbox) and the control endpoint; a
 * bound thread's completion is written when the session settles, never at an `agent_end`.
 */
export function createThreadComponent(options: ThreadComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "thread",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const host = options.host ?? createLiveThreadSurface(pi)
      const stateDirectory = options.stateDirectory ?? defaultThreadStateDirectory(pi)
      const agentDir = options.agentDir ?? (() => resolveAgentHome({ env: process.env }))
      const runtimeInstance = hostInstanceOf(pi)
      const store = options.store ?? createGatewayStore({ agentDir: agentDir(), ...(runtimeInstance === undefined ? {} : { runtimeInstance }) })
      const run: RunContext = { turn: 0, cause: undefined }
      registerThreadTools(pi, {
        host,
        stateDirectory,
        store,
        diskSessions: options.diskSessions,
        ensureHost: options.ensureHost,
        callerSessionId: options.callerSessionId ?? (() => UNKNOWN_CALLER),
        callerWorkspaceRoot: options.callerWorkspaceRoot ?? (() => pi.cwd ?? process.cwd()),
        sendThroughGateway: options.sendThroughGateway ?? THREAD_SENDS_THROUGH_GATEWAY,
        callerTurnId: () => (run.turn === 0 ? undefined : `turn-${run.turn}`),
        callerCause: () => run.cause,
      })
      const registrant = registerControlEndpoint(pi, ctx, options, store, agentDir, run)
      const completions = createCompletionTracker((durableId, outcome) => store.emitCompletions({ now: Date.now(), session_durable_id: durableId, outcome }))
      pi.on("agent_start", () => {
        run.turn++
      })
      pi.on("agent_end", (event, eventCtx) => {
        const durableId = durableIdOf(eventCtx)
        if (durableId !== undefined) completions.agentEnd(durableId, event as AgentEndFacts)
      })
      pi.on("agent_settled", async (_event, eventCtx) => {
        const durableId = durableIdOf(eventCtx)
        run.cause = undefined
        if (durableId === undefined) return
        await completions.settled(durableId).catch((error: unknown) => ctx.logger.warn(`thread gateway: completion reports were not written: ${error instanceof Error ? error.message : String(error)}`))
      })
      pi.on("session_shutdown", async () => {
        await registrant?.stop().catch((error: unknown) => ctx.logger.warn(`thread gateway: control endpoint teardown failed: ${error instanceof Error ? error.message : String(error)}`))
        if (options.store === undefined) await store.dispose().catch(() => undefined)
      })
    },
  }
}
