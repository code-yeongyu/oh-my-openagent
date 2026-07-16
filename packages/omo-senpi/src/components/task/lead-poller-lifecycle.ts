import type { Message } from "@oh-my-opencode/team-core/types"
import {
  createLeadPoller,
  readMemberTaskMap,
  type ActiveTeamSummary,
  type LeadInjection,
  type LeadPoller,
  type LeadPollerDeps,
  type ParentState,
  type PersistedTaskEvent,
  type TeamCoreConfig,
  type WaitRegistry,
} from "@oh-my-opencode/senpi-task"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import type { TaskRuntimeContext } from "./runtime-context"

export type LeadPollerPort = Pick<LeadPoller, "pollOnce" | "shutdown">
export type LeadPollerFactoryInput = LeadPollerDeps

export type LeadPollerLifecycleDeps = {
  readonly listTeams: () => Promise<readonly ActiveTeamSummary[]>
  readonly runtime: Pick<TaskRuntimeContext, "sessionId" | "sessionFile" | "parentState">
  readonly config: TeamCoreConfig
  readonly runtimeDir: (teamRunId: string) => string
  readonly waitRegistry: WaitRegistry<Message>
  readonly appendTaskEvent: (taskId: string, event: PersistedTaskEvent) => void
  readonly pi: Pick<SenpiExtensionAPI, "sendUserMessage">
  readonly logger: ComponentLogger
  readonly coordinator?: Pick<IdleInjectionCoordinator, "enqueue" | "scheduleFlush" | "flushSoon">
  readonly createPoller?: (input: LeadPollerFactoryInput) => LeadPollerPort
  readonly readMemberTaskMap?: (runtimeDir: string) => Promise<Readonly<Record<string, string>>>
  readonly scheduleInterval?: (tick: () => void, intervalMs: number) => () => void
}

export type LeadPollerLifecycle = {
  tick(): Promise<void>
  resolveLeadPoller(teamRunId: string): LeadPollerPort | undefined
  resolveTeamRunId(explicit?: string): Promise<
    | { readonly ok: true; readonly teamRunId: string }
    | { readonly ok: false; readonly reason: string }
  >
  shutdown(): void
}

type OwnedPoller = {
  readonly ownerSessionId: string
  readonly poller: LeadPollerPort
}

const POLL_INTERVAL_MS = 1_000

export function createLeadPollerLifecycle(deps: LeadPollerLifecycleDeps): LeadPollerLifecycle {
  const pollers = new Map<string, OwnedPoller>()
  const createPoller = deps.createPoller ?? createLeadPoller
  const readMap = deps.readMemberTaskMap ?? readMemberTaskMap
  const sink = createInjectionSink(deps)
  let stopped = false
  let syncInFlight: Promise<readonly ActiveTeamSummary[]> | undefined
  let tickInFlight: Promise<void> | undefined

  const synchronize = (): Promise<readonly ActiveTeamSummary[]> => {
    if (syncInFlight !== undefined) return syncInFlight
    const pending = synchronizeOwnedPollers().finally(() => {
      syncInFlight = undefined
    })
    syncInFlight = pending
    return pending
  }

  const synchronizeOwnedPollers = async (): Promise<readonly ActiveTeamSummary[]> => {
    if (stopped) return []
    const sessionId = deps.runtime.sessionId()
    const teams = await deps.listTeams()
    const owned = sessionId === undefined
      ? []
      : teams.filter((team) => team.leadSessionId === sessionId)
    const ownedIds = new Set(owned.map((team) => team.teamRunId))

    for (const [teamRunId, entry] of pollers) {
      if (entry.ownerSessionId === sessionId && ownedIds.has(teamRunId)) continue
      entry.poller.shutdown()
      pollers.delete(teamRunId)
    }

    if (sessionId === undefined || deps.runtime.sessionFile() === undefined) return owned
    for (const team of owned) {
      if (pollers.has(team.teamRunId)) continue
      const memberTaskMap = await readMap(deps.runtimeDir(team.teamRunId))
      if (stopped || deps.runtime.sessionId() !== sessionId || deps.runtime.sessionFile() === undefined) break
      const poller = createPoller({
        teamRunId: team.teamRunId,
        config: deps.config,
        coordinator: sink,
        waitRegistry: deps.waitRegistry,
        appendEvent: deps.appendTaskEvent,
        eventTaskId: (message) => memberTaskMap[message.from],
        leadSessionFile: () => deps.runtime.sessionFile(),
      })
      pollers.set(team.teamRunId, { ownerSessionId: sessionId, poller })
    }
    return owned
  }

  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve()
    if (deps.runtime.sessionFile() === undefined) return Promise.resolve()
    if (tickInFlight !== undefined) return tickInFlight
    const pending = (async () => {
      const owned = await synchronize()
      if (deps.runtime.sessionFile() === undefined) return
      if (isTransition(deps.runtime.parentState())) return
      for (const team of owned) {
        const poller = resolveLeadPoller(team.teamRunId)
        if (poller !== undefined) await poller.pollOnce()
      }
    })().finally(() => {
      tickInFlight = undefined
    })
    tickInFlight = pending
    return pending
  }

  const resolveLeadPoller = (teamRunId: string): LeadPollerPort | undefined => {
    if (stopped || deps.runtime.sessionFile() === undefined || isTransition(deps.runtime.parentState())) return undefined
    const entry = pollers.get(teamRunId)
    if (entry === undefined || entry.ownerSessionId !== deps.runtime.sessionId()) return undefined
    return entry.poller
  }

  const resolveTeamRunId = async (explicit?: string): Promise<
    | { readonly ok: true; readonly teamRunId: string }
    | { readonly ok: false; readonly reason: string }
  > => {
    const owned = await synchronize()
    if (explicit !== undefined) {
      return owned.some((team) => team.teamRunId === explicit)
        ? { ok: true, teamRunId: explicit }
        : { ok: false, reason: `Team ${explicit} is not owned by the current session.` }
    }
    const onlyTeam = owned[0]
    if (owned.length === 1 && onlyTeam !== undefined) return { ok: true, teamRunId: onlyTeam.teamRunId }
    if (owned.length === 0) return { ok: false, reason: "No active team is owned by the current session." }
    return { ok: false, reason: "Multiple teams are owned by the current session; pass team_run_id." }
  }

  const disposeInterval = (deps.scheduleInterval ?? scheduleInterval)(() => {
    void tick().catch((error: unknown) => {
      deps.logger.warn("omo-senpi lead poller tick failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, POLL_INTERVAL_MS)

  return {
    tick,
    resolveLeadPoller,
    resolveTeamRunId,
    shutdown() {
      if (stopped) return
      stopped = true
      disposeInterval()
      for (const entry of pollers.values()) entry.poller.shutdown()
      pollers.clear()
    },
  }

  function createInjectionSink(input: LeadPollerLifecycleDeps): { enqueue(injection: LeadInjection): void } {
    return {
      enqueue(injection) {
        if (input.coordinator === undefined) {
          input.pi.sendUserMessage(injection.content, { deliverAs: "steer" })
          injection.onFlushed?.()
          return
        }
        input.coordinator.enqueue(injection)
        const parentState = input.runtime.parentState()
        switch (parentState.kind) {
          case "streaming":
            input.coordinator.scheduleFlush()
            return
          case "idle":
            input.coordinator.flushSoon()
            return
          case "compacting":
          case "session_switching":
          case "session_shutdown":
            return
          default:
            return assertNever(parentState)
        }
      },
    }
  }
}

function isTransition(state: ParentState): boolean {
  switch (state.kind) {
    case "idle":
    case "streaming":
      return false
    case "compacting":
    case "session_switching":
    case "session_shutdown":
      return true
    default:
      return assertNever(state)
  }
}

function scheduleInterval(tick: () => void, intervalMs: number): () => void {
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected parent state: ${String(value)}`)
}
