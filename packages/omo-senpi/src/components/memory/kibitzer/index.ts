// The resident Kibitzer composition: ONE sidecar per bound main session, fed by the parent's hooks.
//
// A hook handler is the only moment the host ctx is alive, so everything the sidecar will ever need
// from it is read synchronously right there: the branch snapshot (`sessionManager.getBranch()`, which
// is both the event cursor and what `session_entries` pages), the model registry the child threads
// into its own session, and the hook payload itself. The event goes into the session's bounded
// stream at once; only the candidate collection (a git read of the memory corpus) runs detached,
// over the plain snapshot, and ends in `sidecar.offer` - which wakes the child only for a candidate
// path this sidecar lifetime has not judged. `tool_result` completes the rich event and never wakes.
// Settle is bookkeeping (the branch snapshot is refreshed, delivery is told the turn ended); there is
// no settle wake. Every settled wake is handed to `observe.ts`, which appends its `wakes.ndjson`
// line beside the child transcript and keeps the diagnostic streak behind the `omo-kibitzer:gate`
// notice. Session shutdown disposes the sidecar - which hands back its machine-wide wake lease -
// releases its sidecar directory and drains delivery. The sidecar is created lazily on the first
// hook of a bound session whose `memory.recall.enabled` is on; that switch is the only way to keep
// it from existing.

import { GitMemoryRepo, PendingNudges, RecallCorpusCache, RecallLedger, type RecallNudge } from "@oh-my-opencode/memory-core"
import type { ChildModelRegistry } from "@oh-my-opencode/senpi-task"

import type { IdleInjectionCoordinator } from "../../../extension/idle-injection-coordinator"
import type { ComponentLogger, SenpiExtensionAPI } from "../../../extension/types"
import { resolveAgentHome } from "../../agent-home/resolve-agent-home"
import type { SenpiOmoConfigResult } from "../../config-resolution"
import type { MemoryIdentityContext } from "../context"
import { resolveMemoryModelRegistry } from "../model-registry-resolver"
import { toolArgTexts, ToolArgWindow } from "../recall-query-planner-tools"
import type { RecallSessionSnapshot } from "../recall-session-read"
import { resolveAgentRecallSettings, type MemoryRecallWiring } from "../recall-wiring"
import { sessionIdFrom } from "../wiring-context"
import { createKibitzerDelivery, type KibitzerDelivery, type KibitzerDeliveryOptions } from "./delivery"
import { registerKibitzerHooks } from "./hooks"
import { createKibitzerObservability, kibitzerSidecarSessionDir } from "./observe"
import { resolveKibitzerSidecarSettings, type KibitzerSidecarSettings } from "./settings"
import { createKibitzerSidecar, type KibitzerSidecar } from "./sidecar"
import { createKibitzerSidecarChildStarter, type KibitzerSidecarChildStarterOptions } from "./sidecar-model"
import type { KibitzerWakeOutcome } from "./sidecar-outcome"
import { createKibitzerSidecarTools } from "./tools"
import { createKibitzerWakeSlot } from "./wake-slot"

/** QA seams of the resident child starter: the runner, the session construction, the persona and the task runtime. */
export type KibitzerChildStarterSeams = Pick<KibitzerSidecarChildStarterOptions, "createRunner" | "createSession" | "loadPersona" | "loadTaskRuntime">

export interface KibitzerCompositionOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  /** The primary agent's workspace: the sidecar's `read`/`grep` are scoped to it. */
  readonly cwd: () => string
  readonly loadConfig: (options: { readonly cwd?: string }) => SenpiOmoConfigResult
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  /** The synchronous ctx read and the detached lexical collection over its snapshot. */
  readonly recall: Pick<MemoryRecallWiring, "snapshotSession" | "collectCandidatesFromSnapshot">
  /** Shared with recall so the sidecar's `memory` tool reads the corpus the candidates came from. */
  readonly corpusCache?: RecallCorpusCache
  readonly coordinator?: IdleInjectionCoordinator
  readonly sendMessage: KibitzerDeliveryOptions["sendMessage"]
  readonly appendEntry: (customType: string, data?: unknown) => void
  readonly childStarter?: KibitzerChildStarterSeams
  /** QA seam: every settled wake of every sidecar, after `observe.ts` has recorded it. */
  readonly onWake?: (outcome: KibitzerWakeOutcome, context: MemoryIdentityContext) => void
  readonly logger?: ComponentLogger
}

export interface KibitzerComposition {
  readonly delivery: KibitzerDelivery
  /** Registers the four Kibitzer hooks; call it after the projection and recall-drain handlers. */
  registerHooks(pi: SenpiExtensionAPI): void
  onCompactionAccepted(sessionId: string, context: MemoryIdentityContext | undefined): void
  /** Aborts and disposes the session's sidecar (releasing its wake lease and its directory) and drains its delivery. */
  onSessionShutdown(sessionId: string): Promise<void>
  /** Resolves once every detached collection has ended, every running turn has settled and every wake record is on disk. */
  whenIdle(): Promise<void>
  /** Main sessions that own a live sidecar right now. */
  activeSessions(): readonly string[]
}

export { kibitzerSidecarSessionDir } from "./observe"

/** What a hook reads off the live ctx for the sidecar to use later, once the ctx is gone. */
interface CapturedSession {
  /** The newest branch snapshot, refreshed synchronously at every hook; `session_entries` pages it. */
  branch: readonly unknown[]
  /** The newest registry the hooks saw; the child starter reads it when a child starts. */
  registry: ChildModelRegistry | undefined
}

interface SessionSidecar {
  readonly sessionId: string
  readonly context: MemoryIdentityContext
  readonly sidecar: KibitzerSidecar
  readonly captured: CapturedSession
}

type HookKind = "prompt" | "tool_call" | "tool_result"

export function createKibitzerComposition(options: KibitzerCompositionOptions): KibitzerComposition {
  const logger = options.logger
  const corpusCache = options.corpusCache ?? new RecallCorpusCache()
  const argWindow = new ToolArgWindow()
  const sidecars = new Map<string, SessionSidecar>()
  const inFlight = new Set<Promise<void>>()
  const observe = createKibitzerObservability({
    appendEntry: options.appendEntry,
    ...(logger === undefined ? {} : { logger }),
  })
  const delivery = createKibitzerDelivery({
    ledgerFor: (context) => new RecallLedger(context.identityPaths.recallLedger),
    pendingFor: (context) => new PendingNudges(context.identityPaths.recallPending),
    sendMessage: options.sendMessage,
    appendEntry: options.appendEntry,
    ...(options.coordinator === undefined ? {} : { coordinator: options.coordinator }),
    ...(logger === undefined ? {} : { logger }),
  })

  function warn(message: string, details: Record<string, unknown>): void {
    logger?.warn(message, details)
  }

  function track(task: () => Promise<void>): void {
    let promise: Promise<void>
    promise = task()
      .catch((error: unknown) => warn("omo-senpi kibitzer offer failed", { error: describe(error) }))
      .finally(() => inFlight.delete(promise))
    inFlight.add(promise)
  }

  // ---- one sidecar per bound main session ----------------------------------------------------

  function sidecarFor(sessionId: string): SessionSidecar | undefined {
    const existing = sidecars.get(sessionId)
    if (existing !== undefined) return existing
    const context = options.resolveContext(sessionId)
    if (context === undefined) return undefined
    const recall = resolveAgentRecallSettings(options.loadConfig({ cwd: options.cwd() }).config.memory, context.identity)
    if (!recall.enabled) return undefined
    const created = createSessionSidecar(sessionId, context, resolveKibitzerSidecarSettings(recall))
    sidecars.set(sessionId, created)
    return created
  }

  function createSessionSidecar(sessionId: string, context: MemoryIdentityContext, settings: KibitzerSidecarSettings): SessionSidecar {
    const cwd = options.cwd()
    const captured: CapturedSession = { branch: [], registry: undefined }
    const repo = new GitMemoryRepo({ dir: context.identityPaths.repo, agentId: context.identity })
    const startChild = createKibitzerSidecarChildStarter({
      cwd,
      sessionDir: kibitzerSidecarSessionDir(context.identityPaths.recall, sessionId),
      agentDir: resolveAgentHome({ env: options.env }),
      category: settings.category,
      loadConfig: () => options.loadConfig({ cwd: options.cwd() }).config,
      modelRegistry: () => captured.registry,
      ...options.childStarter,
    })
    const sidecar = createKibitzerSidecar({
      sessionId,
      startChild,
      createTools: (binding) => createKibitzerSidecarTools({
        workspaceRoot: cwd,
        session: { entries: () => captured.branch },
        memory: { repo, cache: corpusCache },
        nudge: binding.nudge,
        budget: binding.budget,
      }),
      deliver: (nudges: readonly RecallNudge[]) => delivery.accept(sessionId, context, nudges),
      onWake: (outcome) => {
        observe.onWake(outcome, context)
        options.onWake?.(outcome, context)
      },
      wakeSlot: createKibitzerWakeSlot({ locksDirectory: context.identityPaths.locks, maxConcurrent: settings.maxConcurrentWakes }),
      toolBudget: settings.toolBudget,
      sidecarMaxTokens: settings.sidecarMaxTokens,
      eventCaps: settings.eventCaps,
      ...(logger === undefined ? {} : { logger }),
    })
    // The directory is owned from this moment: no sweep, from this process or another, may take it.
    observe.own(sessionId, context)
    return { sessionId, context, sidecar, captured }
  }

  // ---- the hook sink: synchronous capture, detached offer ----------------------------------

  function capture(kind: HookKind, payload: unknown, eventCtx: unknown): void {
    const snapshot = options.recall.snapshotSession(eventCtx)
    if (snapshot === undefined) return
    const record = sidecarFor(snapshot.id)
    if (record === undefined) return
    record.captured.branch = snapshot.entries
    const registry = resolveMemoryModelRegistry(eventCtx)
    if (registry !== undefined) record.captured.registry = registry
    let extraTexts: readonly string[]
    switch (kind) {
      case "prompt":
        record.sidecar.events.onPrompt(payload, snapshot.entries)
        extraTexts = promptTexts(payload)
        break
      case "tool_call":
        record.sidecar.events.onToolCall(payload, snapshot.entries)
        if (isToolCallPayload(payload)) argWindow.push(snapshot.id, toolArgTexts(payload.toolName, payload.input))
        extraTexts = argWindow.texts(snapshot.id)
        break
      case "tool_result":
        record.sidecar.events.onToolResult(payload, snapshot.entries)
        return
      default:
        return kind satisfies never
    }
    track(() => offer(record, snapshot, extraTexts))
  }

  /** Detached: touches nothing but the plain snapshot, then lets the sidecar decide whether to wake. */
  async function offer(record: SessionSidecar, snapshot: RecallSessionSnapshot, extraTexts: readonly string[]): Promise<void> {
    const collected = await options.recall.collectCandidatesFromSnapshot(snapshot, extraTexts)
    if (collected === undefined || collected.sessionId !== record.sessionId) return
    await record.sidecar.offer({ candidates: collected.candidates, surfaced: collected.surfaced, maxItems: collected.maxItems })
  }

  function onSettled(eventCtx: unknown): void {
    const snapshot = options.recall.snapshotSession(eventCtx)
    if (snapshot === undefined) return
    const record = sidecars.get(snapshot.id)
    if (record !== undefined) record.captured.branch = snapshot.entries
  }

  return {
    delivery,
    registerHooks(pi): void {
      registerKibitzerHooks(pi, {
        env: options.env,
        sink: {
          onPrompt: (payload, eventCtx) => capture("prompt", payload, eventCtx),
          onToolCall: (payload, eventCtx) => capture("tool_call", payload, eventCtx),
          onToolResult: (payload, eventCtx) => capture("tool_result", payload, eventCtx),
          onSettled,
        },
        delivery,
        resolveContext: options.resolveContext,
        resolveSessionId: sessionIdFrom,
        ...(logger === undefined ? {} : { logger }),
      })
    },
    onCompactionAccepted(sessionId, context): void {
      // The sidecar keeps its own context across a parent compaction; only the held nudges, judged
      // against the transcript the compaction rewrote, are dropped by delivery.
      if (context !== undefined) void delivery.onCompactionAccepted(sessionId, context)
    },
    async onSessionShutdown(sessionId): Promise<void> {
      const record = sidecars.get(sessionId)
      sidecars.delete(sessionId)
      argWindow.clear(sessionId)
      if (record !== undefined) {
        await record.sidecar.shutdown()
        await observe.onSessionShutdown(sessionId, record.context)
      }
      delivery.onSessionShutdown(sessionId)
    },
    async whenIdle(): Promise<void> {
      while (inFlight.size > 0) await Promise.all([...inFlight])
      await Promise.all([...sidecars.values()].map((record) => record.sidecar.whenIdle()))
      await observe.whenIdle()
    },
    activeSessions: () => [...sidecars.keys()],
  }
}

function promptTexts(payload: unknown): readonly string[] {
  if (typeof payload === "string") return [payload]
  return isRecord(payload) && typeof payload.prompt === "string" ? [payload.prompt] : []
}

function isToolCallPayload(value: unknown): value is { readonly toolName: string; readonly input: Record<string, unknown> } {
  return isRecord(value) && typeof value.toolName === "string" && isRecord(value.input)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
