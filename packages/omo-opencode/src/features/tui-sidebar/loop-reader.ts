import { readdirSync, readFileSync, statSync } from "node:fs"
import type { Dirent } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

import { LOOP_FRESH_MS } from "./constants"
import type { LoopLive, LoopState } from "./state-types"

const CriterionSchema = z.object({
  status: z.string(),
})

const GoalBaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
})

const CurrentLoopSchema = z.object({
  version: z.literal(1),
  activeGoalId: z.string().optional(),
  goals: z.array(
    GoalBaseSchema.extend({
      successCriteria: z.array(CriterionSchema),
    }),
  ),
})

const LegacyLoopSchema = z.object({
  goals: z.array(
    GoalBaseSchema.extend({
      criteria: z.array(CriterionSchema),
    }),
  ),
})

type ParsedGoal = {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly criteria: readonly z.infer<typeof CriterionSchema>[]
}

type ParsedLoop = {
  readonly activeGoalId: string | null
  readonly goals: readonly ParsedGoal[]
}

type LoopCandidate = {
  readonly path: string
  readonly mtimeMs: number
}

type LiveCandidate = {
  readonly state: LoopLive
  readonly mtimeMs: number
}

export function readActiveLoop(projectDir: string): LoopState {
  const liveCandidates = enumerateCandidates(projectDir)
    .map(readLiveCandidate)
    .filter((candidate) => candidate !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)

  return liveCandidates[0]?.state ?? { kind: "none" }
}

function enumerateCandidates(projectDir: string): readonly LoopCandidate[] {
  return [...currentLoopCandidates(projectDir), legacyLoopCandidate(projectDir)].filter(
    (candidate) => candidate !== null,
  )
}

function currentLoopCandidates(projectDir: string): readonly LoopCandidate[] {
  const loopRoot = join(projectDir, ".omo", "ulw-loop")
  let entries: Dirent<string>[]
  try {
    entries = readdirSync(loopRoot, { withFileTypes: true })
  } catch (error) {
    if (error instanceof Error) {
      return []
    }
    throw error
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => statCandidate(join(loopRoot, entry.name, "goals.json")))
    .filter((candidate) => candidate !== null)
}

function legacyLoopCandidate(projectDir: string): LoopCandidate | null {
  return statCandidate(join(projectDir, ".omo", "loop", "goals.json"))
}

function statCandidate(path: string): LoopCandidate | null {
  try {
    return { path, mtimeMs: statSync(path).mtimeMs }
  } catch (error) {
    if (error instanceof Error) {
      return null
    }
    throw error
  }
}

function readLiveCandidate(candidate: LoopCandidate): LiveCandidate | null {
  if (Date.now() - candidate.mtimeMs > LOOP_FRESH_MS) {
    return null
  }

  const parsed = readParsedLoop(candidate.path)
  if (parsed === null || !parsed.goals.some((goal) => goal.status === "in_progress")) {
    return null
  }

  return { state: computeLoopLive(parsed), mtimeMs: candidate.mtimeMs }
}

function readParsedLoop(path: string): ParsedLoop | null {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    if (error instanceof Error) {
      return null
    }
    throw error
  }

  const current = CurrentLoopSchema.safeParse(raw)
  if (current.success) {
    return {
      activeGoalId: current.data.activeGoalId ?? null,
      goals: current.data.goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        criteria: goal.successCriteria,
      })),
    }
  }

  const legacy = LegacyLoopSchema.safeParse(raw)
  if (legacy.success) {
    return {
      activeGoalId: null,
      goals: legacy.data.goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        criteria: goal.criteria,
      })),
    }
  }

  return null
}

function computeLoopLive(loop: ParsedLoop): LoopLive {
  const counts = loop.goals.reduce(
    (accumulator, goal) => {
      for (const criterion of goal.criteria) {
        switch (criterion.status) {
          case "pass":
            accumulator.pass += 1
            break
          case "fail":
            accumulator.fail += 1
            break
          case "blocked":
            accumulator.blocked += 1
            break
          case "pending":
            accumulator.pending += 1
            break
          default:
            accumulator.pending += 1
            break
        }
      }
      return accumulator
    },
    { pass: 0, fail: 0, pending: 0, blocked: 0 },
  )

  return {
    kind: "live",
    goalsDone: loop.goals.filter((goal) => goal.status === "complete").length,
    goalsTotal: loop.goals.length,
    pass: counts.pass,
    fail: counts.fail,
    pending: counts.pending,
    blocked: counts.blocked,
    activeGoal: activeGoalTitle(loop),
  }
}

function activeGoalTitle(loop: ParsedLoop): string | null {
  const byId = loop.goals.find((goal) => goal.id === loop.activeGoalId)
  if (byId !== undefined) {
    return byId.title
  }

  return loop.goals.find((goal) => goal.status === "in_progress")?.title ?? null
}
