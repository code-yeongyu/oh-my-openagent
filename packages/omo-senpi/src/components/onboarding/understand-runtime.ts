import { basename } from "node:path"

import type { FactsExtractionRecord } from "@oh-my-opencode/memory-core"

import type { SessionDigest } from "./session-history"
import {
  ONBOARDING_UNDERSTAND_BUDGET,
  type OnboardingFactCandidate,
  type OnboardingUnderstandBudgetKind,
  type OnboardingUnderstandBudgetLimits,
  type OnboardingUnderstandEvent,
  type OnboardingUnderstandStep,
} from "./understand-contract"
import type { OnboardingUnderstandingControl } from "./understand-control"
import { readStep, runStep, stepPayload, type StepRead, type UnderstandingModel } from "./understand-step"

export interface OnboardingUnderstandingInput extends Omit<UnderstandingModel, "env"> {
  readonly understandId: string
  readonly scanId: string
  readonly digests: readonly SessionDigest[]
  /** Project roots the scan listed; a step reads AGENTS.md only inside one of these. */
  readonly projectRoots: ReadonlySet<string>
  readonly control: OnboardingUnderstandingControl
  readonly budget?: OnboardingUnderstandBudgetLimits
  readonly env?: NodeJS.ProcessEnv
  readonly today?: string
  readonly now?: () => number
}

interface StepGroup {
  readonly project?: string
  readonly digests: readonly SessionDigest[]
}

interface Candidate {
  readonly key: string
  readonly id: string
  readonly fact: FactsExtractionRecord
  readonly sources: readonly string[]
}

type EventBody = Omit<OnboardingUnderstandEvent, "understandId" | "scanId" | "bytesRead" | "toolCalls" | "elapsedMs">

/**
 * "Understanding you": the facts extractor reads the scan's session digests (plus each project's AGENTS.md)
 * one project at a time and proposes facts. Candidates only; nothing reaches memory here.
 */
export async function runOnboardingUnderstanding(
  input: OnboardingUnderstandingInput,
  emit: (event: OnboardingUnderstandEvent) => void,
): Promise<OnboardingUnderstandEvent> {
  // A step that timed out may still be disposing a child that writes into its scratch dir; the run
  // settles only after every such dir is removed again, while `done` has already been emitted.
  const scratchCleanups: Promise<void>[] = []
  try {
    return await understand(input, emit, scratchCleanups)
  } finally {
    await Promise.all(scratchCleanups)
  }
}

async function understand(
  input: OnboardingUnderstandingInput,
  emit: (event: OnboardingUnderstandEvent) => void,
  scratchCleanups: Promise<void>[],
): Promise<OnboardingUnderstandEvent> {
  const budget = input.budget ?? ONBOARDING_UNDERSTAND_BUDGET
  const today = input.today ?? new Date().toISOString().slice(0, 10)
  const model: UnderstandingModel = { ...input, env: input.env ?? process.env }
  const { control } = input
  const now = input.now ?? (() => performance.now())
  const startedAt = now()
  const elapsed = (): number => Math.round(now() - startedAt)
  let bytesRead = 0
  let toolCalls = 0
  let candidates: Candidate[] = []
  const send = (body: EventBody): OnboardingUnderstandEvent => {
    const event: OnboardingUnderstandEvent = { understandId: input.understandId, scanId: input.scanId, ...body, bytesRead, toolCalls, elapsedMs: elapsed() }
    emit(event)
    return event
  }
  const finish = (extra: Partial<EventBody> = {}) => send({ kind: "done", candidates: candidates.map(publicCandidate), ...extra })

  let stepNumber = 0
  for (const group of planSteps(input.digests, budget.minSourceSessions)) {
    if (control.stopped) return finish({ stopped: true })
    const live = group.digests.filter((digest) => !control.isSkipped(digest.cwd))
    if (live.length < budget.minSourceSessions) continue
    if (budget.totalMs - elapsed() <= 0) {
      send({ kind: "budget", budget: "total_ms" })
      return finish()
    }
    const read = await readStep(live, group.project, budget.readBytes - bytesRead, input.projectRoots)
    if (read.digests.length < budget.minSourceSessions) {
      send({ kind: "budget", budget: "read_bytes" })
      return finish()
    }
    bytesRead += read.bytes
    stepNumber += 1
    const step = describeStep(`step-${stepNumber}`, group.project, read)
    send({ kind: "step_started", step })

    const runOnce = () => runStep({
      model,
      payload: stepPayload(read, group.project, today, budget.minSourceSessions),
      deadlineMs: Math.min(budget.stepMs, budget.totalMs - elapsed()),
      maxCalls: budget.toolCalls - toolCalls,
      onCall: () => { toolCalls += 1 },
      control,
      projects: new Set(read.digests.map((digest) => digest.cwd)),
      onScratchCleanup: (cleanup) => { scratchCleanups.push(cleanup) },
    })
    let result = await runOnce()
    if (result.status === "failed") {
      if (budget.totalMs - elapsed() <= 0) {
        send({ kind: "step_failed", step, reason: result.reason })
        send({ kind: "budget", budget: "total_ms" })
        return finish()
      }
      send({ kind: "step_failed", step, reason: result.reason, retrying: true })
      result = await runOnce()
      if (result.status === "failed") {
        send({ kind: "step_failed", step, reason: result.reason })
        candidates = []
        return finish({ fallback: "scan_only" })
      }
    }
    if (result.status === "cancelled") {
      if (control.stopped) return finish({ stopped: true })
      send({ kind: "step_done", step, skipped: true })
      continue
    }

    const sources = read.digests.map((digest) => digest.sessionKey)
    let factsCapped = false
    for (const record of result.records) {
      const key = factKey(record)
      const index = candidates.findIndex((candidate) => candidate.key === key)
      if (index >= 0) {
        const existing = candidates[index]!
        candidates[index] = { ...existing, sources: [...new Set([...existing.sources, ...sources])] }
      } else if (candidates.length >= budget.maxFacts) {
        factsCapped = true
      } else if (sources.length >= budget.minSourceSessions) {
        const candidate: Candidate = { key, id: `fact-${candidates.length + 1}`, fact: record, sources }
        candidates.push(candidate)
        send({ kind: "fact", fact: publicCandidate(candidate) })
      }
    }
    if (candidates.length >= budget.maxFacts) factsCapped = true
    const reached: OnboardingUnderstandBudgetKind[] = [
      ...(result.status === "timeout" ? [elapsed() >= budget.totalMs ? "total_ms" as const : "step_ms" as const] : []),
      ...(toolCalls >= budget.toolCalls ? ["tool_calls" as const] : []),
      ...(read.truncated ? ["read_bytes" as const] : []),
      ...(factsCapped ? ["max_facts" as const] : []),
    ]
    for (const kind of reached) send({ kind: "budget", budget: kind })
    send({ kind: "step_done", step })
    if (reached.some((kind) => kind !== "step_ms")) return finish()
  }
  return finish()
}

function planSteps(digests: readonly SessionDigest[], minSessions: number): StepGroup[] {
  const newestFirst = [...digests].sort((left, right) => right.lastActiveAt.localeCompare(left.lastActiveAt))
  const byProject = new Map<string, SessionDigest[]>()
  for (const digest of newestFirst) byProject.set(digest.cwd, [...(byProject.get(digest.cwd) ?? []), digest])
  const groups: StepGroup[] = []
  const singles: SessionDigest[] = []
  for (const [project, own] of byProject) {
    if (own.length >= minSessions) groups.push({ project, digests: own })
    else singles.push(...own)
  }
  if (singles.length >= minSessions) groups.push({ digests: singles })
  return groups
}

function describeStep(id: string, project: string | undefined, read: StepRead): OnboardingUnderstandStep {
  const sessions = read.digests.length
  if (project !== undefined) return { id, label: `Read ${sessions} recent sessions in ${basename(project)}`, project, sessions }
  const projects = new Set(read.digests.map((digest) => digest.cwd)).size
  return { id, label: `Read ${sessions} recent sessions across ${projects} projects`, sessions }
}

function factKey(record: FactsExtractionRecord): string {
  const text = record.text.toLowerCase().replace(/\s+/g, " ").trim()
  return record.scope === "person" ? `person:${record.person.name.toLowerCase()}:${text}` : `project:${text}`
}

function publicCandidate(candidate: Candidate): OnboardingFactCandidate {
  return { id: candidate.id, fact: candidate.fact, sources: candidate.sources }
}
