import type { GitCommitAuthor, GitMemoryRepo } from "../git"
import { applyFactsRecovery } from "./recovery"
import {
  FactsPlanParentDirtyError,
  factsRecordsHash,
  planFactsMutation,
  type FactsApplyRecovery,
} from "./mutation-plan"
import type { FactsAliasTie, FactsPeopleRouting } from "./person-routing"
import type { FactsQueueEntry } from "./schema"

export interface FactsPersonReference {
  readonly name: string
  readonly aliases: readonly string[]
}

export type FactsExtractionRecord =
  | { readonly scope: "person"; readonly person: FactsPersonReference; readonly text: string; readonly date: string }
  | { readonly scope: "project"; readonly text: string; readonly date: string }

export interface FactsBatch {
  readonly batchId: string
  readonly records: readonly FactsExtractionRecord[]
}

export interface FactsKnownPerson {
  readonly slug: string
  readonly displayName: string
  readonly aliases: readonly string[]
}

export interface FactsPayload {
  readonly version: 1
  readonly identity: string
  readonly today: string
  readonly entries: readonly FactsQueueEntry[]
  readonly knownPeople: readonly FactsKnownPerson[]
  readonly primaryHuman: { readonly slug: "human"; readonly aliases: readonly string[] }
}

export type ApplyFactsBatchResult =
  | { readonly outcome: "committed"; readonly sha: string; readonly affectedPaths: readonly string[] }
  | { readonly outcome: "no_facts"; readonly affectedPaths: readonly [] }
  | { readonly outcome: "parent_dirty" }

export interface ApplyFactsBatchOptions {
  readonly people?: FactsPeopleRouting
  readonly onAliasTie?: (tie: FactsAliasTie) => void
  readonly publishRecovery?: (recovery: FactsApplyRecovery) => Promise<void>
}

export class FactsExtractionValidationError extends Error {
  override readonly name = "FactsExtractionValidationError"
}

export function parseFactsExtractionJsonl(raw: string): FactsExtractionRecord[] {
  const records: FactsExtractionRecord[] = []
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw invalid(index, "line is not valid JSON")
    }
    records.push(parseRecord(value, index))
  }
  return records
}

export async function applyFactsBatch(
  repo: GitMemoryRepo,
  batch: FactsBatch,
  author: GitCommitAuthor,
  options: ApplyFactsBatchOptions = {},
): Promise<ApplyFactsBatchResult> {
  validateFactsBatchId(batch.batchId)
  if (batch.records.length === 0) return { outcome: "no_facts", affectedPaths: [] }
  try {
    const recovery = await planFactsMutation(repo, batch, options.people, options.onAliasTie)
    await options.publishRecovery?.(recovery)
    return applyFactsRecovery(repo, recovery, batch.records.length, author)
  } catch (error) {
    if (error instanceof FactsPlanParentDirtyError) return { outcome: "parent_dirty" }
    throw error
  }
}

export function validateFactsRecovery(
  recovery: FactsApplyRecovery,
  batch: FactsBatch,
): void {
  validateFactsBatchId(batch.batchId)
  if (recovery.version !== 1
    || recovery.batchId !== batch.batchId
    || recovery.recordsHash !== factsRecordsHash(batch.records)
    || recovery.paths.some((entry, index) => index > 0 && recovery.paths[index - 1]!.path >= entry.path)) {
    throw new TypeError("Invalid facts applyRecovery envelope")
  }
}

function parseRecord(value: unknown, index: number): FactsExtractionRecord {
  if (!isRecord(value)) throw invalid(index, "record must be an object")
  const text = nonEmpty(value.text)
  const date = validDate(value.date)
  if (text === undefined) throw invalid(index, "text must be non-empty")
  if (date === undefined) throw invalid(index, "date must be YYYY-MM-DD")
  if (value.scope === "project") {
    if ("person" in value) throw invalid(index, "project record must not carry person")
    assertKeys(value, ["scope", "text", "date"], index)
    return { scope: "project", text, date }
  }
  if (value.scope !== "person") throw invalid(index, "scope must be person or project")
  if (!("person" in value)) throw invalid(index, "person record requires person")
  assertKeys(value, ["scope", "person", "text", "date"], index)
  if (!isRecord(value.person)) throw invalid(index, "person must be an object")
  assertKeys(value.person, ["name", "aliases"], index)
  const name = nonEmpty(value.person.name)
  if (name === undefined || !Array.isArray(value.person.aliases)) throw invalid(index, "person requires name and aliases")
  const aliases = value.person.aliases.map(nonEmpty)
  if (aliases.some((alias) => alias === undefined)) throw invalid(index, "person aliases must be non-empty strings")
  return { scope: "person", person: { name, aliases: aliases as string[] }, text, date }
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], index: number): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key))
  if (extra !== undefined) throw invalid(index, `unexpected field: ${extra}`)
}

function validateFactsBatchId(batchId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
    throw new TypeError("facts batchId must be a UUID v4")
  }
}

function validDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value ? value : undefined
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function invalid(index: number, message: string): FactsExtractionValidationError {
  return new FactsExtractionValidationError(`facts extraction line ${index + 1}: ${message}`)
}
