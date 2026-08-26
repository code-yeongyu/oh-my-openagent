import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"

import type {
  MemoryIdentityPaths,
  ReflectionTranscriptState,
} from "@oh-my-opencode/memory-core"

export interface PalaceReflectionOutcome {
  readonly runId: string
  readonly outcome: string
  readonly finishedAt: string
}

export interface PalaceReflection {
  readonly cursor?: ReflectionTranscriptState
  readonly conversationId?: string
  readonly outcomes: readonly PalaceReflectionOutcome[]
}

export async function collectReflection(
  paths: MemoryIdentityPaths,
  options: { readonly limit: number },
): Promise<PalaceReflection> {
  const [cursor, outcomes] = await Promise.all([
    readLatestCursor(paths.transcripts),
    readOutcomes(join(paths.reflection, "completions"), options.limit),
  ])
  return {
    outcomes,
    ...(cursor === undefined ? {} : { cursor: cursor.state, conversationId: cursor.conversationId }),
  }
}

async function readLatestCursor(
  transcriptsDir: string,
): Promise<{ readonly conversationId: string; readonly state: ReflectionTranscriptState } | undefined> {
  const conversations = await readdir(transcriptsDir, { withFileTypes: true }).catch(() => [])
  let latest: { conversationId: string; state: ReflectionTranscriptState; modifiedAt: number } | undefined
  for (const entry of conversations) {
    if (!entry.isDirectory()) continue
    const statePath = join(transcriptsDir, entry.name, "state.json")
    const parsed = await readJson(statePath)
    if (!isReflectionState(parsed)) continue
    const modifiedAt = await stat(statePath).then((info) => info.mtimeMs).catch(() => 0)
    if (latest === undefined || modifiedAt > latest.modifiedAt) {
      latest = { conversationId: entry.name, state: parsed, modifiedAt }
    }
  }
  if (latest === undefined) return undefined
  return { conversationId: latest.conversationId, state: latest.state }
}

async function readOutcomes(
  completionsDir: string,
  limit: number,
): Promise<readonly PalaceReflectionOutcome[]> {
  const files = await readdir(completionsDir).catch(() => [])
  const outcomes: PalaceReflectionOutcome[] = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    const parsed = await readJson(join(completionsDir, file))
    if (!isRecord(parsed)) continue
    const runId = typeof parsed.runId === "string" ? parsed.runId : file.replace(/\.json$/, "")
    const outcome = typeof parsed.outcome === "string" ? parsed.outcome : "unknown"
    const finishedAt = typeof parsed.finishedAt === "string" ? parsed.finishedAt : ""
    outcomes.push({ runId, outcome, finishedAt })
  }
  return outcomes
    .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt))
    .slice(0, Math.max(0, limit))
}

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8").catch(() => undefined)
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function isReflectionState(value: unknown): value is ReflectionTranscriptState {
  return (
    isRecord(value) &&
    typeof value.total_completed_steps === "number" &&
    typeof value.reflected_completed_steps === "number"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
