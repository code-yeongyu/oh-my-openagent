import {
  createNodeGitExec,
  GitMemoryRepo,
  type MemoryIdentity,
  type ReflectionOutcome,
  type ReflectionWorktree,
} from "@oh-my-opencode/memory-core"

export interface ReservationRunLedger {
  readonly version: 1
  readonly runId: string
  readonly attempt?: number
  readonly model?: string
  readonly thinking?: string
  readonly category?: string
  readonly conversationIds?: readonly string[]
  readonly launching?: boolean
  readonly kind: "reflection" | "dream"
  readonly trigger: "step-count" | "compaction" | "manual" | "dream"
  readonly origin?: "manual" | "idle" | "shutdown" | "pressure"
  readonly pid?: number
  readonly processStart?: string | null
  readonly childPid?: number
  readonly childProcessStart?: string | null
  readonly startedAt: string
  readonly hardDeadlineAt: number
  readonly terminationGraceMs: number
  readonly deadlineAt: number
  readonly mergePolicy: "auto" | "integration"
  readonly targetDoc?: string
  readonly systemTokenBudget?: number
  readonly systemTokenTarget?: number
  readonly worktreeDir: string
  readonly worktreeBranch: string
  readonly baseSha: string
  readonly gitFilePath: string
  readonly gitFileSnapshot: string
  readonly commonConfigPath: string
  readonly commonConfigSnapshot: string | null
  readonly finalizePhase?: "validated" | "integrated" | "settled"
  readonly validatedTipSha?: string
  readonly validatedChangedPaths?: readonly string[]
  readonly integrationSha?: string
  readonly finalizeOutcome?: ReflectionOutcome
  readonly finalizeReason?: string
  readonly finalizeDetail?: string
  readonly finalizedAt?: string
}

export function parseReservationRunLedger(value: unknown): ReservationRunLedger {
  if (!isRecord(value)) throw new Error("Invalid reservation run ledger")
  const trigger = value.trigger
  const kind = value.kind
  if (value.version !== 1 || typeof value.runId !== "string") throw new Error("Invalid reservation run ledger identity")
  if (kind !== "reflection" && kind !== "dream") throw new Error("Invalid reservation run kind")
  if (trigger !== "step-count" && trigger !== "compaction" && trigger !== "manual" && trigger !== "dream") {
    throw new Error("Invalid reservation run trigger")
  }
  if ((kind === "dream") !== (trigger === "dream")) throw new Error("Reservation run kind and trigger disagree")
  if (trigger === "dream" && value.origin !== "manual" && value.origin !== "idle" && value.origin !== "shutdown" && value.origin !== "pressure") {
    throw new Error("Dream run origin is required")
  }
  const requiredStrings = ["startedAt", "worktreeDir", "worktreeBranch", "baseSha", "gitFilePath", "gitFileSnapshot", "commonConfigPath"] as const
  if (requiredStrings.some((field) => typeof value[field] !== "string")) throw new Error("Invalid reservation run paths")
  const requiredNumbers = ["hardDeadlineAt", "terminationGraceMs", "deadlineAt"] as const
  if (requiredNumbers.some((field) => typeof value[field] !== "number" || !Number.isFinite(value[field]))) {
    throw new Error("Invalid reservation run deadline")
  }
  const hardDeadlineAt = Number(value.hardDeadlineAt)
  const terminationGraceMs = Number(value.terminationGraceMs)
  if (Number(value.deadlineAt) !== hardDeadlineAt + terminationGraceMs) throw new Error("Reservation run deadline mismatch")
  if (value.mergePolicy !== "auto" && value.mergePolicy !== "integration") throw new Error("Invalid reservation merge policy")
  if (value.targetDoc !== undefined && (kind !== "dream" || typeof value.targetDoc !== "string")) {
    throw new Error("Invalid dream target document")
  }
  for (const field of ["systemTokenBudget", "systemTokenTarget"] as const) {
    if (value[field] !== undefined
      && (kind !== "dream" || !Number.isInteger(value[field]) || Number(value[field]) <= 0)) {
      throw new Error(`Invalid dream ${field}`)
    }
  }
  if ((value.systemTokenBudget === undefined) !== (value.systemTokenTarget === undefined)) {
    throw new Error("Dream token budget metadata is incomplete")
  }
  if (!optionalPid(value.pid) || !optionalIdentity(value.processStart) || !optionalPid(value.childPid) || !optionalIdentity(value.childProcessStart)) {
    throw new Error("Invalid reservation process identity")
  }
  if (value.attempt !== undefined && (!Number.isInteger(value.attempt) || Number(value.attempt) <= 0)) {
    throw new Error("Invalid reservation run attempt")
  }
  if (value.model !== undefined && typeof value.model !== "string") throw new Error("Invalid reservation run model")
  if (value.thinking !== undefined && typeof value.thinking !== "string") throw new Error("Invalid reservation run thinking")
  if (value.category !== undefined && typeof value.category !== "string") throw new Error("Invalid reservation run category")
  if (value.conversationIds !== undefined
    && (!Array.isArray(value.conversationIds) || !value.conversationIds.every((id) => typeof id === "string"))) {
    throw new Error("Invalid reservation run conversations")
  }
  if (value.launching !== undefined && typeof value.launching !== "boolean") {
    throw new Error("Invalid reservation run launching state")
  }
  if (value.commonConfigSnapshot !== null && typeof value.commonConfigSnapshot !== "string") {
    throw new Error("Invalid common config snapshot")
  }
  if (value.finalizePhase !== undefined
    && value.finalizePhase !== "validated"
    && value.finalizePhase !== "integrated"
    && value.finalizePhase !== "settled") {
    throw new Error("Invalid finalization phase")
  }
  for (const field of ["validatedTipSha", "integrationSha", "finalizeReason", "finalizeDetail", "finalizedAt"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") throw new Error(`Invalid ${field}`)
  }
  if (value.validatedChangedPaths !== undefined
    && (!Array.isArray(value.validatedChangedPaths) || !value.validatedChangedPaths.every((path) => typeof path === "string"))) {
    throw new Error("Invalid validated changed paths")
  }
  if (value.finalizeOutcome !== undefined && !isReflectionOutcome(value.finalizeOutcome)) {
    throw new Error("Invalid finalization outcome")
  }
  return value as unknown as ReservationRunLedger
}

export function worktreeFromLedger(identity: MemoryIdentity, ledger: ReservationRunLedger): ReflectionWorktree {
  return {
    parent: new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id }),
    dir: ledger.worktreeDir,
    branch: ledger.worktreeBranch,
    baseSha: ledger.baseSha,
    gitFilePath: ledger.gitFilePath,
    gitFileSnapshot: ledger.gitFileSnapshot,
    commonConfigPath: ledger.commonConfigPath,
    commonConfigSnapshot: ledger.commonConfigSnapshot,
    exec: createNodeGitExec(),
  }
}

function optionalPid(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && Number(value) > 0)
}

function optionalIdentity(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isReflectionOutcome(value: unknown): value is ReflectionOutcome {
  return value === "merged"
    || value === "no_changes"
    || value === "parent_dirty"
    || value === "dirty_uncommitted"
    || value === "merge_conflict"
    || value === "admin_tamper"
    || value === "timed_out"
    || value === "failed"
}
