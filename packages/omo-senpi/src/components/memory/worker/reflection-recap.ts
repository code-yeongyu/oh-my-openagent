import { constants, lstat, open, readFile, realpath, retryOnEintr, type FileHandle, type Stats } from "@oh-my-opencode/memory-core/fs"
import { join, relative, isAbsolute } from "node:path"
import { z } from "zod"
import { stripTerminalControls } from "@oh-my-opencode/senpi-task/renderer-text"
import type { MemoryIdentityContext } from "../context"
import type { ReflectionCompletionRecord } from "./completion-contracts"
import { parseReservationRunLedger } from "./reservation-run-ledger"

export interface ReflectionRecap {
  readonly schemaVersion: 1
  readonly key: string
  readonly identity: string
  readonly runId: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly conversationIds: readonly string[]
  readonly deliverySessionId?: string
  readonly mergedCommitSha: string
  readonly filesChanged?: number
  readonly changedPaths: readonly string[]
  readonly report: ReflectionReport
}

export type ReflectionReport =
  | { readonly status: "available"; readonly text: string; readonly preview: string; readonly sourceTruncated: boolean }
  | { readonly status: "unavailable"; readonly reason: string }

const outcomeSchema = z.object({
  version: z.literal(1), runId: z.string(), attempt: z.number().int().positive(),
  childExit: z.object({ code: z.literal(0), signal: z.null() }), timedOut: z.literal(false),
})
const finalSchema = z.object({
  version: z.literal(1), runId: z.string(), outcome: z.literal("merged"),
  finishedAt: z.string(), integrationSha: z.string(),
})
export const REFLECTION_REPORT_MAX_BYTES = 65_536

export function reflectionRecapKey(record: ReflectionCompletionRecord): string {
  return JSON.stringify([record.identity, record.runId, record.startedAt, record.finishedAt])
}

/** Read projection only. Absent historical proof preserves the legacy operational notice. */
export async function readReflectionRecap(
  context: MemoryIdentityContext,
  record: ReflectionCompletionRecord,
): Promise<ReflectionRecap | undefined> {
  if (record.outcome !== "merged" || record.identity !== context.identity
    || !record.mergedCommitSha?.trim() || !safeRelativePath(record.runId) || record.runId.includes("/")) return undefined
  const runDir = join(context.identityPaths.reflection, "runs", record.runId)
  try {
    const root = await realpath(context.identityPaths.reflection)
    if (!confined(root, await realpath(runDir))) return undefined
    const ledger = parseReservationRunLedger(await readArtifact(runDir, "ledger.json"))
    const outcome = outcomeSchema.parse(await readArtifact(runDir, "outcome.json"))
    if (ledger.runId !== record.runId || ledger.startedAt !== record.startedAt
      || ledger.finalizedAt !== record.finishedAt || ledger.finalizeOutcome !== "merged"
      || ledger.integrationSha !== record.mergedCommitSha || outcome.runId !== record.runId
      || outcome.attempt !== ledger.attempt || ledger.validatedChangedPaths === undefined
      || !ledger.validatedChangedPaths.every(safeRelativePath)) return undefined
    if (await optionalArtifact(runDir, "abandoned.json") !== undefined) return undefined
    const final = await optionalArtifact(runDir, "final.json")
    if (final !== undefined) {
      const parsed = finalSchema.parse(final)
      if (parsed.runId !== record.runId || parsed.finishedAt !== record.finishedAt
        || parsed.integrationSha !== record.mergedCommitSha) return undefined
    }
    return {
      schemaVersion: 1, key: reflectionRecapKey(record), identity: record.identity,
      runId: record.runId, startedAt: record.startedAt, finishedAt: record.finishedAt,
      conversationIds: record.conversationIds,
      ...(record.delivery.sessionId === undefined ? {} : { deliverySessionId: record.delivery.sessionId }),
      mergedCommitSha: record.mergedCommitSha,
      ...(record.filesChanged === undefined ? {} : { filesChanged: record.filesChanged }),
      changedPaths: ledger.validatedChangedPaths,
      report: await readReflectionReport(runDir),
    }
  } catch (error) {
    // Artifact errors are unavailable provenance, never a failed memory write.
    if (error instanceof Error) return undefined
    throw error
  }
}

export function sanitizeReflectionReport(text: string): string {
  return stripTerminalControls(text, { preserveWhitespace: true })
}

type ReadReportChunk = (file: FileHandle, buffer: Buffer, offset: number) => Promise<number>
const readReportChunk: ReadReportChunk = async (file, buffer, offset) =>
  (await file.read(buffer, offset, buffer.length - offset, offset)).bytesRead

export async function readReflectionReport(runDir: string, readChunk: ReadReportChunk = readReportChunk): Promise<ReflectionReport> {
  const unavailable = (reason: string): ReflectionReport => ({ status: "unavailable", reason })
  const path = join(runDir, "child-stdout.log")
  try {
    const before = await lstat(path)
    if (!before.isFile() || !confined(await realpath(runDir), await realpath(path))) return unavailable("unsafe_file")
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const opened = await file.stat()
      if (!sameFile(before, opened)) return unavailable("changing_file")
      const buffer = Buffer.alloc(Math.min(opened.size, REFLECTION_REPORT_MAX_BYTES + 1))
      let offset = 0
      while (offset < buffer.length) {
        const bytesRead = await retryOnEintr(() => readChunk(file, buffer, offset))
        if (bytesRead === 0) return unavailable("incomplete_output")
        offset += bytesRead
      }
      if (!sameFile(opened, await file.stat()) || !sameFile(opened, await lstat(path))) return unavailable("changing_file")
      if (buffer.length === 0) return unavailable("empty_output")
      const sourceTruncated = opened.size > REFLECTION_REPORT_MAX_BYTES
      const end = sourceTruncated ? buffer.subarray(0, REFLECTION_REPORT_MAX_BYTES).lastIndexOf(10) + 1 : buffer.length
      if (end === 0 || buffer[end - 1] !== 10) return unavailable("incomplete_output")
      let decoded: string
      try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, end)) }
      catch (error) { if (error instanceof TypeError) return unavailable("invalid_utf8"); throw error }
      const text = sanitizeReflectionReport(decoded)
      if (!text.trim()) return unavailable("empty_output")
      const preview = Array.from(text.split("\n").filter((line) => line.trim()).slice(0, 3).join("\n")).slice(0, 600).join("")
      return { status: "available", text, preview, sourceTruncated }
    } finally { await file.close() }
  } catch (error) {
    if (error instanceof Error) return unavailable("code" in error && error.code === "ENOENT" ? "missing_output" : "unreadable_output")
    throw error
  }
}

function sameFile(left: Stats, right: Stats): boolean {
  return right.isFile() && left.dev === right.dev && left.ino === right.ino
    && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
}

function safeRelativePath(path: string): boolean {
  return path.length > 0 && !isAbsolute(path) && !/[\\\x00-\x1f\x7f-\x9f:]/u.test(path)
    && path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && part !== ".git")
}

function confined(root: string, path: string): boolean {
  const tail = relative(root, path)
  return tail.length > 0 && !tail.startsWith("..") && !isAbsolute(tail)
}

async function readArtifact(runDir: string, name: string): Promise<unknown> {
  const path = join(runDir, name)
  if (!(await lstat(path)).isFile() || !confined(await realpath(runDir), await realpath(path))) throw new TypeError("Unsafe recap artifact")
  return JSON.parse(await readFile(path, "utf8"))
}

async function optionalArtifact(runDir: string, name: string): Promise<unknown> {
  try { return await readArtifact(runDir, name) }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}
