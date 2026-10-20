import { mkdtemp, open, readFile, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, isAbsolute, join, relative, sep } from "node:path"

import { parseFactsExtractionRecord, type FactsExtractionRecord } from "@oh-my-opencode/memory-core"
import type { CreateChildSession, InProcessRunnerLike } from "@oh-my-opencode/senpi-task"

import type { ComponentLogger } from "../../extension/types"
import { launchFactsInProcess } from "../memory/facts-in-process-launch"
import type { InProcessMemoryChildState } from "../memory/in-process-memory-child"
import type { ChildModelRegistry } from "../memory/model-registry-resolver"
import { readRunJson, writeRunJsonAtomic, type RunOutcome } from "../memory/worker/run-artifacts"
import type { SessionDigest } from "./session-history"
import { digestByteLength } from "./session-history/session-digest"
import type { OnboardingUnderstandingControl } from "./understand-control"

export interface UnderstandingModel {
  readonly model: string
  readonly modelRegistry: ChildModelRegistry
  readonly env: NodeJS.ProcessEnv
  readonly createRunner?: (options: { readonly createSession?: CreateChildSession }) => InProcessRunnerLike
  readonly createSession?: CreateChildSession
  readonly logger?: ComponentLogger
}

export interface StepRead {
  readonly digests: readonly SessionDigest[]
  readonly agentsMd?: { readonly path: string; readonly text: string }
  readonly bytes: number
  readonly truncated: boolean
}

export type StepResult =
  | { readonly status: "completed" | "timeout" | "cancelled"; readonly records: readonly FactsExtractionRecord[] }
  | { readonly status: "failed"; readonly reason: string; readonly records: readonly FactsExtractionRecord[] }

export async function readStep(
  digests: readonly SessionDigest[],
  project: string | undefined,
  limit: number,
  projectRoots: ReadonlySet<string>,
): Promise<StepRead> {
  const kept: SessionDigest[] = []
  let bytes = 0
  let truncated = false
  for (const digest of digests) {
    const size = digestByteLength(digest)
    if (bytes + size > limit) {
      truncated = true
      break
    }
    kept.push(digest)
    bytes += size
  }
  if (project === undefined || truncated || !projectRoots.has(project)) return { digests: kept, bytes, truncated }
  const inside = await agentsMdInside(project)
  const agentsMd = inside === undefined ? undefined : await readBounded(inside, limit - bytes)
  if (agentsMd === undefined) return { digests: kept, bytes, truncated }
  return {
    digests: kept,
    agentsMd: { path: join(project, "AGENTS.md"), text: agentsMd.text },
    bytes: bytes + agentsMd.bytes,
    truncated: agentsMd.truncated,
  }
}

/** The real path of `<root>/AGENTS.md` when it resolves inside the root itself; a symlink out of the project is never followed. */
async function agentsMdInside(root: string): Promise<string | undefined> {
  const resolved = await Promise.all([realpath(root), realpath(join(root, "AGENTS.md"))]).catch(() => undefined)
  if (resolved === undefined) return undefined
  const [realRoot, realFile] = resolved
  const path = relative(realRoot, realFile)
  if (path === "" || isAbsolute(path) || path.split(sep)[0] === "..") return undefined
  return realFile
}

async function readBounded(path: string, limit: number): Promise<{ readonly text: string; readonly bytes: number; readonly truncated: boolean } | undefined> {
  const handle = await open(path, "r").catch(() => undefined)
  if (handle === undefined) return undefined
  try {
    const stats = await handle.stat()
    if (!stats.isFile()) return undefined
    const buffer = Buffer.alloc(Math.max(0, Math.min(stats.size, limit)))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return { text: buffer.subarray(0, bytesRead).toString("utf8"), bytes: bytesRead, truncated: stats.size > limit }
  } finally {
    await handle.close()
  }
}

export function stepPayload(read: StepRead, project: string | undefined, today: string, minSessions: number): string {
  const where = project === undefined ? "across several projects" : `in ${project}`
  return [
    `Onboarding: digests of the user's recent coding-agent sessions ${where}${read.agentsMd === undefined ? "" : ", and the project's AGENTS.md"}. Today is ${today}.`,
    `Record only durable facts about the user or their projects that at least ${minSessions} different sessions below support. Never record secrets, credentials, or one-off task details.`,
    "",
    "<session_digests>",
    ...read.digests.map((digest) => JSON.stringify(digest)),
    "</session_digests>",
    ...(read.agentsMd === undefined ? [] : [`<agents_md path=${JSON.stringify(read.agentsMd.path)}>`, read.agentsMd.text, "</agents_md>"]),
  ].join("\n")
}

/**
 * One model call through the facts extractor's own launch path and `record_fact` tool, in a scratch run
 * directory outside memory that is removed afterwards. The records are returned; nothing is applied.
 */
export async function runStep(input: {
  readonly model: UnderstandingModel
  readonly payload: string
  readonly deadlineMs: number
  readonly maxCalls: number
  readonly onCall: () => void
  readonly control: OnboardingUnderstandingControl
  readonly projects: ReadonlySet<string>
  /** Receives the removal that runs again once every started child is disposed, even after this step returned. */
  readonly onScratchCleanup: (cleanup: Promise<void>) => void
}): Promise<StepResult> {
  const runDir = await mkdtemp(join(tmpdir(), "omo-onboarding-understand-"))
  const runId = basename(runDir)
  const children = new Set<InProcessMemoryChildState>()
  try {
    await writeRunJsonAtomic(join(runDir, "ledger.json"), { version: 1, runId, kind: "facts" })
    let cancelled: boolean
    try {
      cancelled = await launchFactsInProcess({
        runId,
        runDir,
        payload: input.payload,
        resolution: { kind: "resolved", category: "quick", model: input.model.model, fallbacks: [] },
        modelRegistry: input.model.modelRegistry,
        options: {
          ...(input.model.createRunner === undefined ? {} : { createRunner: input.model.createRunner }),
          ...(input.model.createSession === undefined ? {} : { createSession: input.model.createSession }),
          ...(input.model.logger === undefined ? {} : { logger: input.model.logger }),
        },
        env: input.model.env,
        configSources: [],
        batchId: runId,
        queued: [],
        launchedAt: Date.now(),
        deadlineMs: input.deadlineMs,
        recordLimits: { maxCalls: input.maxCalls, onCall: input.onCall },
        onState: (state) => {
          children.add(state)
          if (state.cancel !== undefined) input.control.attach(input.projects, () => state.cancel?.())
        },
      })
    } catch (error) {
      return { status: "failed", reason: error instanceof Error ? error.message : String(error), records: [] }
    } finally {
      input.control.detach()
    }
    const records = await readRecords(join(runDir, "extraction.jsonl"))
    if (cancelled) return { status: "cancelled", records }
    const outcome = await readRunJson<RunOutcome>(join(runDir, "outcome.json")).catch(() => undefined)
    if (outcome?.timedOut === true) return { status: "timeout", records }
    if (outcome?.childExit.code === 0) return { status: "completed", records }
    return { status: "failed", reason: "the model call failed", records }
  } finally {
    await rm(runDir, { recursive: true, force: true })
    const released = [...children].flatMap((state) => (state.released === undefined ? [] : [state.released]))
    if (released.length > 0) {
      input.onScratchCleanup(Promise.allSettled(released).then(async (settled) => {
        for (const outcome of settled) {
          if (outcome.status === "rejected") input.model.logger?.warn("onboarding understanding child disposal failed", { runId, error: String(outcome.reason) })
        }
        await rm(runDir, { recursive: true, force: true })
      }))
    }
  }
}

async function readRecords(path: string): Promise<FactsExtractionRecord[]> {
  const raw = await readFile(path, "utf8").catch(() => "")
  const records: FactsExtractionRecord[] = []
  for (const [index, line] of raw.split("\n").entries()) {
    if (line.trim().length === 0) continue
    try {
      records.push(parseFactsExtractionRecord(JSON.parse(line), index))
    } catch {
      continue
    }
  }
  return records
}
