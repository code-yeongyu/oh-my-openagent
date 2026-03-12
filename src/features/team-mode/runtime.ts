import { randomUUID } from "node:crypto"
import {
  DEFAULT_TEAM_CLAIM_LEASE_MS,
  DEFAULT_TEAM_WORKER_COUNT,
  TEAM_WORKER_ID_PREFIX,
} from "./constants"
import { getTeamStatePath, listTeamIds, readTeamRuntimeState, writeTeamRuntimeState } from "./state"
import type {
  ClaimTeamTaskInput,
  ClaimTeamTaskResult,
  InitializeTeamModeInput,
  MailboxMessageInput,
  ShutdownRequestInput,
  TeamMailboxMessage,
  TeamManifest,
  TeamMonitorState,
  TeamPhase,
  TeamRuntimeState,
  TeamSummaryState,
  TeamTaskRecord,
  TeamWorkerRecord,
  TransitionTeamTaskInput,
} from "./types"

function nowIso(now?: string): string {
  return now ?? new Date().toISOString()
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

function createTeamId(planName: string, timestamp: string): string {
  return `${slugify(planName) || "team"}-${timestamp.slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6)}`
}

function parsePlanTaskLines(content: string, timestamp: string): TeamTaskRecord[] {
  return content
    .split("\n")
    .map((line, index) => ({ line, sourceLine: index + 1 }))
    .filter(({ line }) => /^\s*[-*]\s*\[\s*\]/.test(line))
    .map(({ line, sourceLine }, index) => ({
      id: `task-${index + 1}`,
      title: line.replace(/^\s*[-*]\s*\[\s*\]\s*/, "").trim() || `Task ${index + 1}`,
      source_line: sourceLine,
      status: "pending" as const,
      version: 1,
      updated_at: timestamp,
      transitions: [],
    }))
}

function createWorkers(workerCount: number, leaderSessionId: string, timestamp: string): TeamWorkerRecord[] {
  return [
    {
      id: "leader",
      role: "leader",
      status: "running",
      session_id: leaderSessionId,
      claimed_task_ids: [],
      started_at: timestamp,
      updated_at: timestamp,
    },
    ...Array.from({ length: workerCount }, (_, index) => ({
      id: `${TEAM_WORKER_ID_PREFIX}${index + 1}`,
      role: "worker" as const,
      status: "pending" as const,
      claimed_task_ids: [],
      updated_at: timestamp,
    })),
  ]
}

function createSummary(tasks: TeamTaskRecord[], timestamp: string): TeamSummaryState {
  const summary: TeamSummaryState = {
    total_tasks: tasks.length,
    pending_tasks: 0,
    blocked_tasks: 0,
    running_tasks: 0,
    completed_tasks: 0,
    failed_tasks: 0,
    updated_at: timestamp,
  }

  for (const task of tasks) {
    if (task.status === "pending") summary.pending_tasks += 1
    if (task.status === "blocked") summary.blocked_tasks += 1
    if (task.status === "in_progress") summary.running_tasks += 1
    if (task.status === "completed") summary.completed_tasks += 1
    if (task.status === "failed") summary.failed_tasks += 1
  }

  return summary
}

function createMonitor(workers: TeamWorkerRecord[], tasks: TeamTaskRecord[], timestamp: string): TeamMonitorState {
  return {
    worker_status: Object.fromEntries(workers.map((worker) => [worker.id, worker.status])),
    active_claims: Object.fromEntries(
      tasks.filter((task) => task.claim).map((task) => [task.id, task.claim!.owner]),
    ),
    last_task_event_at: tasks
      .flatMap((task) => task.transitions.map((transition) => transition.at))
      .sort()
      .at(-1),
    updated_at: timestamp,
  }
}

function withDerivedState(state: TeamRuntimeState, timestamp: string): TeamRuntimeState {
  return {
    ...state,
    manifest: {
      ...state.manifest,
      updated_at: timestamp,
    },
    summary: createSummary(state.tasks, timestamp),
    monitor: createMonitor(state.workers, state.tasks, timestamp),
  }
}

function reclaimExpiredClaims(tasks: TeamTaskRecord[], timestamp: string): TeamTaskRecord[] {
  return tasks.map((task) => {
    if (!task.claim) return task
    if (new Date(task.claim.leased_until).getTime() > new Date(timestamp).getTime()) return task
    if (task.status !== "in_progress") return task

    return {
      ...task,
      status: "pending",
      owner: undefined,
      claim: undefined,
      version: task.version + 1,
      updated_at: timestamp,
      transitions: [...task.transitions, { from: "in_progress", to: "pending", worker_id: task.claim.owner, at: timestamp }],
    }
  })
}

function updateWorkerClaimedTaskIds(workers: TeamWorkerRecord[], tasks: TeamTaskRecord[], timestamp: string): TeamWorkerRecord[] {
  return workers.map((worker) => {
    const claimed = tasks
      .filter((task) => task.owner === worker.id && (task.status === "in_progress" || task.status === "blocked"))
      .map((task) => task.id)

    let status = worker.status
    if (worker.role === "worker" && status !== "shutdown") {
      if (claimed.length > 0) status = "running"
      else if (status === "running") status = "idle"
    }

    return {
      ...worker,
      claimed_task_ids: claimed,
      status,
      updated_at: timestamp,
    }
  })
}

function readPlanFile(planPath: string): string {
  return require("node:fs").readFileSync(planPath, "utf-8")
}

export function findActiveTeamForLeaderSession(directory: string, leaderSessionId: string): TeamRuntimeState | null {
  for (const teamId of listTeamIds(directory)) {
    const state = readTeamRuntimeState(directory, teamId)
    if (!state) continue
    if (state.manifest.leader_session_id !== leaderSessionId) continue
    if (state.manifest.phase === "shutdown" || state.manifest.phase === "completed") continue
    return state
  }

  return null
}

export function initializeTeamRuntime(input: InitializeTeamModeInput): TeamRuntimeState {
  const timestamp = nowIso()
  const existing = findActiveTeamForLeaderSession(input.directory, input.leaderSessionId)
  if (existing) {
    return existing
  }

  const teamId = createTeamId(input.planName, timestamp)
  const tasks = parsePlanTaskLines(readPlanFile(input.planPath), timestamp)
  const workers = createWorkers(Math.max(1, input.workerCount ?? DEFAULT_TEAM_WORKER_COUNT), input.leaderSessionId, timestamp)

  const state: TeamRuntimeState = {
    manifest: {
      team_id: teamId,
      execution_mode: "teammode",
      created_at: timestamp,
      updated_at: timestamp,
      directory: input.directory,
      plan_path: input.planPath,
      plan_name: input.planName,
      ...(input.worktreePath ? { worktree_path: input.worktreePath } : {}),
      leader_session_id: input.leaderSessionId,
      phase: "starting",
    },
    workers,
    tasks,
    mailbox: [],
    governance: {
      leader_session_id: input.leaderSessionId,
      allow_resume: true,
      active_claim_lease_ms: input.claimLeaseMs ?? DEFAULT_TEAM_CLAIM_LEASE_MS,
    },
    phase: {
      current: "starting",
      updated_at: timestamp,
      history: [{ phase: "starting", at: timestamp }],
    },
    summary: createSummary(tasks, timestamp),
    monitor: createMonitor(workers, tasks, timestamp),
  }

  writeTeamRuntimeState(input.directory, state)
  return state
}

export function setTeamPhase(directory: string, teamId: string, phase: TeamPhase, reason?: string): TeamRuntimeState | null {
  const state = readTeamRuntimeState(directory, teamId)
  if (!state) return null
  const timestamp = nowIso()
  const next: TeamRuntimeState = withDerivedState({
    ...state,
    manifest: {
      ...state.manifest,
      phase,
      updated_at: timestamp,
    },
    phase: {
      current: phase,
      updated_at: timestamp,
      history: [...state.phase.history, { phase, at: timestamp, ...(reason ? { reason } : {}) }],
    },
  }, timestamp)
  writeTeamRuntimeState(directory, next)
  return next
}

export function markTeamWorkersLaunched(
  directory: string,
  teamId: string,
  launchedWorkers: Array<{ id: string; backgroundTaskId: string }>,
): TeamRuntimeState | null {
  const state = readTeamRuntimeState(directory, teamId)
  if (!state) return null

  const timestamp = nowIso()
  const workers = state.workers.map((worker) => {
    const launched = launchedWorkers.find((candidate) => candidate.id === worker.id)
    if (!launched) return worker
    return {
      ...worker,
      background_task_id: launched.backgroundTaskId,
      status: "running" as const,
      started_at: worker.started_at ?? timestamp,
      updated_at: timestamp,
    }
  })

  const next = withDerivedState({
    ...state,
    workers,
    manifest: {
      ...state.manifest,
      phase: "running",
      updated_at: timestamp,
    },
    phase: {
      current: "running",
      updated_at: timestamp,
      history: [...state.phase.history, { phase: "running", at: timestamp }],
    },
  }, timestamp)

  writeTeamRuntimeState(directory, next)
  return next
}

export function claimNextTeamTask(directory: string, teamId: string, input: ClaimTeamTaskInput): ClaimTeamTaskResult {
  const state = readTeamRuntimeState(directory, teamId)
  if (!state) return { ok: false, reason: "worker_not_found" }

  const timestamp = nowIso(input.now)
  const reclaimedTasks = reclaimExpiredClaims(state.tasks, timestamp)
  const worker = state.workers.find((candidate) => candidate.id === input.workerId)
  if (!worker) return { ok: false, reason: "worker_not_found" }

  const taskIndex = reclaimedTasks.findIndex((task) => task.status === "pending")
  if (taskIndex === -1) {
    const next = withDerivedState({ ...state, tasks: reclaimedTasks }, timestamp)
    writeTeamRuntimeState(directory, next)
    return { ok: false, reason: "no_pending_task" }
  }

  const claimToken = randomUUID()
  const leasedUntil = new Date(new Date(timestamp).getTime() + state.governance.active_claim_lease_ms).toISOString()
  const claimedTask: TeamTaskRecord = {
    ...reclaimedTasks[taskIndex],
    status: "in_progress",
    owner: input.workerId,
    claim: {
      owner: input.workerId,
      token: claimToken,
      leased_until: leasedUntil,
    },
    version: reclaimedTasks[taskIndex].version + 1,
    started_at: reclaimedTasks[taskIndex].started_at ?? timestamp,
    updated_at: timestamp,
    transitions: [
      ...reclaimedTasks[taskIndex].transitions,
      { from: reclaimedTasks[taskIndex].status, to: "in_progress", worker_id: input.workerId, at: timestamp },
    ],
  }

  const tasks = reclaimedTasks.toSpliced(taskIndex, 1, claimedTask)
  const workers = updateWorkerClaimedTaskIds(state.workers, tasks, timestamp)
  const next = withDerivedState({ ...state, tasks, workers }, timestamp)
  writeTeamRuntimeState(directory, next)

  return { ok: true, task: claimedTask, claimToken }
}

export function transitionTeamTask(directory: string, teamId: string, input: TransitionTeamTaskInput): TeamTaskRecord {
  const state = readTeamRuntimeState(directory, teamId)
  if (!state) throw new Error(`Unknown team: ${teamId}`)

  const timestamp = nowIso(input.now)
  const reclaimedTasks = reclaimExpiredClaims(state.tasks, timestamp)
  const taskIndex = reclaimedTasks.findIndex((task) => task.id === input.taskId)
  if (taskIndex === -1) throw new Error(`Unknown task: ${input.taskId}`)

  const currentTask = reclaimedTasks[taskIndex]
  if (currentTask.version !== input.expectedVersion) {
    throw new Error(`Task version conflict for ${input.taskId}`)
  }
  if (currentTask.status !== input.fromStatus) {
    throw new Error(`Task status mismatch for ${input.taskId}`)
  }
  if (!currentTask.claim || currentTask.claim.owner !== input.workerId || currentTask.claim.token !== input.claimToken) {
    throw new Error(`Task claim token invalid for ${input.taskId}`)
  }

  const nextTask: TeamTaskRecord = {
    ...currentTask,
    status: input.toStatus,
    version: currentTask.version + 1,
    updated_at: timestamp,
    ...(input.toStatus === "completed" || input.toStatus === "failed" ? { completed_at: timestamp } : {}),
    ...(input.result !== undefined ? { result: input.result } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
    claim: input.toStatus === "in_progress" || input.toStatus === "blocked"
      ? {
          owner: input.workerId,
          token: input.claimToken,
          leased_until: new Date(new Date(timestamp).getTime() + state.governance.active_claim_lease_ms).toISOString(),
        }
      : undefined,
    owner: input.toStatus === "completed" || input.toStatus === "failed" ? input.workerId : currentTask.owner,
    transitions: [...currentTask.transitions, { from: input.fromStatus, to: input.toStatus, worker_id: input.workerId, at: timestamp }],
  }

  const tasks = reclaimedTasks.toSpliced(taskIndex, 1, nextTask)
  const workers = updateWorkerClaimedTaskIds(state.workers, tasks, timestamp)
  const next = withDerivedState({ ...state, tasks, workers }, timestamp)
  writeTeamRuntimeState(directory, next)
  return nextTask
}

export function appendTeamMailboxMessage(directory: string, teamId: string, input: MailboxMessageInput): TeamMailboxMessage {
  const state = readTeamRuntimeState(directory, teamId)
  if (!state) throw new Error(`Unknown team: ${teamId}`)
  const timestamp = nowIso(input.now)
  const message: TeamMailboxMessage = {
    message_id: randomUUID(),
    from_worker: input.fromWorker,
    to_worker: input.toWorker,
    body: input.body,
    created_at: timestamp,
  }
  const next = withDerivedState({ ...state, mailbox: [...state.mailbox, message] }, timestamp)
  writeTeamRuntimeState(directory, next)
  return message
}

export function markTeamMailboxMessageDelivered(directory: string, teamId: string, messageId: string, deliveredAt?: string): TeamMailboxMessage {
  const state = readTeamRuntimeState(directory, teamId)
  if (!state) throw new Error(`Unknown team: ${teamId}`)
  const timestamp = nowIso(deliveredAt)
  const messageIndex = state.mailbox.findIndex((message) => message.message_id === messageId)
  if (messageIndex === -1) throw new Error(`Unknown mailbox message: ${messageId}`)

  const message: TeamMailboxMessage = {
    ...state.mailbox[messageIndex],
    delivered_at: timestamp,
  }
  const mailbox = state.mailbox.toSpliced(messageIndex, 1, message)
  const next = withDerivedState({ ...state, mailbox }, timestamp)
  writeTeamRuntimeState(directory, next)
  return message
}

export function requestTeamShutdown(directory: string, teamId: string, input: ShutdownRequestInput): TeamRuntimeState {
  const state = readTeamRuntimeState(directory, teamId)
  if (!state) throw new Error(`Unknown team: ${teamId}`)
  const timestamp = nowIso(input.now)
  const mode = input.mode ?? "graceful"
  const hasActiveWork = state.tasks.some((task) => task.status === "in_progress" || task.status === "blocked")
  if (mode === "graceful" && hasActiveWork) {
    throw new Error("Cannot gracefully shutdown while tasks are active")
  }

  const phase = mode === "abort" ? "shutdown" : state.tasks.every((task) => task.status === "completed") ? "completed" : "shutdown"
  const next = withDerivedState({
    ...state,
    manifest: {
      ...state.manifest,
      phase,
      updated_at: timestamp,
    },
    governance: {
      ...state.governance,
      shutdown_requested_at: timestamp,
      shutdown_mode: mode,
      shutdown_requested_by: input.requestedBy,
      shutdown_acknowledged_at: timestamp,
    },
    phase: {
      current: phase,
      updated_at: timestamp,
      history: [...state.phase.history, { phase, at: timestamp, reason: `shutdown:${mode}` }],
    },
    workers: state.workers.map((worker) => ({
      ...worker,
      status: worker.role === "leader" ? worker.status : "shutdown",
      updated_at: timestamp,
    })),
  }, timestamp)

  writeTeamRuntimeState(directory, next)
  return next
}

export function getTeamStatePathFromRuntime(state: TeamRuntimeState): string {
  return getTeamStatePath(state.manifest.directory, state.manifest.team_id)
}
