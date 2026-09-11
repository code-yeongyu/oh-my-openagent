import type { OmoTaskTranscriptRetention } from "@oh-my-opencode/omo-config-core"

import { isSpawnSpecV1, type TaskRecord } from "../state"
import type { PersistedTaskEvent } from "../store"
import { ARCHIVE_REDACTION_ID, redactArchiveText, redactArchiveValue } from "./redact"
import type { TranscriptRetentionSelection } from "./selection"

// Machine-consumed marker of the metadata entry inside an archived session JSONL. The session
// header/session_info lines make the archive discoverable by the existing Senpi session finder;
// this entry carries the structured facts an auditor joins on.
export const TASK_ARCHIVE_CUSTOM_TYPE = "omo-senpi.task-archive"

// Machine-consumed marker of the manifest's pointer entry naming the compressed content file.
export const TASK_ARCHIVE_CONTENT_CUSTOM_TYPE = "omo-senpi.task-archive.content"

const TASK_TOOL_CUSTOM_TYPE = "omo-senpi.task-tool"
const TASK_ERROR_CUSTOM_TYPE = "omo-senpi.task-error"
const TASK_TEAM_MESSAGE_CUSTOM_TYPE = "omo-senpi.task-team-message"
const TASK_FALLBACK_CUSTOM_TYPE = "omo-senpi.task-fallback"
const TASK_ARCHIVE_SCHEMA_VERSION = 2

export type ArchiveEntry = {
  readonly type: string
  readonly id: string
  readonly timestamp: string
  readonly customType?: string
  readonly name?: string
  // Session-header only: the cwd the session finder trusts (identity never comes from the
  // directory name).
  readonly cwd?: string
  readonly version?: number
  readonly message?: {
    readonly role: string
    readonly content: readonly { readonly type: "text"; readonly text: string }[]
  }
  readonly data?: Record<string, unknown>
}

// Integrity + truncation facts about the compressed content sidecar, embedded in the manifest's
// pointer entry by the writer (which owns the gzip bytes). Absent for metadata-only archives.
export type ArchiveContentFacts = {
  readonly file: string
  readonly sha256: string
  readonly compressed_bytes: number
  readonly uncompressed_bytes: number
  readonly transcript_truncated: boolean
}

export type ComposeTaskArchiveInput = {
  readonly record: TaskRecord
  // The ALREADY-RECORDED visible event transcript (engine event log). No hidden provider
  // reasoning exists in this source and none is synthesized here.
  readonly events: readonly PersistedTaskEvent[]
  readonly settings: OmoTaskTranscriptRetention
  readonly archiveId: string
  readonly archivedAt: string
  readonly selection: TranscriptRetentionSelection
}

// Compose the MANIFEST: the finder-discoverable session JSONL holding the metadata entry (parent
// linkage, models, outcome, usage, retention reason) and, for full archives, the pointer entry
// naming the gzip-compressed content sidecar. This file is intentionally small: opening it in the
// session picker shows the audit facts without paying for - or exposing - the whole transcript.
export function composeTaskArchiveManifestJsonl(input: ComposeTaskArchiveInput, content: ArchiveContentFacts | undefined): string {
  const { record } = input
  const header = {
    type: "session",
    version: 3,
    id: input.archiveId,
    timestamp: record.created_at,
    ...(cwdOf(record) !== undefined ? { cwd: cwdOf(record) } : {}),
  }
  const info = {
    type: "session_info",
    id: "00000000",
    timestamp: terminalAt(record),
    name: `omo task ${record.name ?? record.task_id} (${record.status})`,
  }
  const metadata = metadataOf(input, {
    count: input.events.length,
    truncated: content?.transcript_truncated ?? false,
  })
  const lines = [
    JSON.stringify(header),
    JSON.stringify(info),
    JSON.stringify({
      type: "custom",
      id: "00000001",
      timestamp: terminalAt(record),
      customType: TASK_ARCHIVE_CUSTOM_TYPE,
      data: metadata,
    }),
  ]
  if (content !== undefined) {
    lines.push(
      JSON.stringify({
        type: "custom",
        id: "00000002",
        timestamp: terminalAt(record),
        customType: TASK_ARCHIVE_CONTENT_CUSTOM_TYPE,
        data: { ...content },
      }),
    )
  }
  return `${lines.join("\n")}\n`
}

// Compose the CONTENT: the full session-shaped JSONL (header, session_info, the shared metadata
// entry, then the original prompt and every visible event), plus the truncation fact for the
// manifest. The writer gzips this text into the compressed sidecar the manifest points at;
// byte-bounded to settings.max_bytes by keeping whole head+tail entries, with truncation
// reported in the metadata.
export function composeTaskArchiveContentJsonl(input: ComposeTaskArchiveInput): { readonly text: string; readonly truncated: boolean } {
  const { record } = input
  const header = {
    type: "session",
    version: 3,
    id: input.archiveId,
    timestamp: record.created_at,
    ...(cwdOf(record) !== undefined ? { cwd: cwdOf(record) } : {}),
  }
  const info = {
    type: "session_info",
    id: "00000000",
    timestamp: terminalAt(record),
    name: `omo task ${record.name ?? record.task_id} (${record.status})`,
  }
  const bounded = boundToBudget(transcriptEntriesOf(input), input.settings.max_bytes)
  const lines = [
    JSON.stringify(header),
    JSON.stringify(info),
    JSON.stringify({
      type: "custom",
      id: "00000001",
      timestamp: terminalAt(record),
      customType: TASK_ARCHIVE_CUSTOM_TYPE,
      data: metadataOf(input, bounded),
    }),
    ...bounded.entries.map((entry) => JSON.stringify(entry)),
  ]
  return { text: `${lines.join("\n")}\n`, truncated: bounded.truncated }
}

// Parse helper for tests and readers: every line is an object; malformed lines are dropped.
export function parseArchiveLines(text: string): readonly (ArchiveEntry & { readonly customType?: string })[] {
  const parsed: ArchiveEntry[] = []
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue
    try {
      const value: unknown = JSON.parse(line)
      if (isRecord(value)) parsed.push(value as ArchiveEntry)
    } catch (error) {
      if (error instanceof SyntaxError) continue
      throw error
    }
  }
  return parsed
}

function cwdOf(record: TaskRecord): string | undefined {
  return record.spawn_spec?.cwd
}

function terminalAt(record: TaskRecord): string {
  return record.terminal_at ?? record.updated_at
}

function metadataOf(
  input: ComposeTaskArchiveInput,
  bounded?: { readonly count: number; readonly truncated: boolean },
): Record<string, unknown> {
  const { record } = input
  // Metadata-only archives (protected work) keep the AUDIT facts and drop every free-text
  // content field: task_summary/description/final_response/error_message can echo protected
  // content (e.g. clinical text) that credential redaction does not - and must not - sanitize.
  const metadataOnly = input.selection.mode === "metadata"
  const toolEvents = input.events.filter((event) => event.type === "tool_execution")
  const toolErrorCount = toolEvents.filter((event) => isRecord(event.payload) && event.payload.is_error === true).length
  return {
    schema_version: TASK_ARCHIVE_SCHEMA_VERSION,
    task_id: record.task_id,
    parent_session_id: record.parent_session_id,
    root_session_id: record.root_session_id,
    ...(record.name !== undefined ? { name: record.name } : {}),
    ...(!metadataOnly && record.task_summary !== undefined ? { task_summary: redactArchiveText(record.task_summary) } : {}),
    ...(!metadataOnly && record.description !== undefined ? { description: redactArchiveText(record.description) } : {}),
    ...(record.category !== undefined ? { category: record.category } : {}),
    ...(record.agent_type !== undefined ? { agent_type: record.agent_type } : {}),
    model: record.model,
    ...(record.requested_model !== undefined ? { requested_model: record.requested_model } : {}),
    ...(record.resolved_model !== undefined ? { resolved_model: record.resolved_model } : {}),
    ...(cwdOf(record) !== undefined ? { cwd: cwdOf(record) } : {}),
    ...(record.started_at !== undefined ? { started_at: record.started_at } : {}),
    terminal_at: terminalAt(record),
    status: record.status,
    ...(!metadataOnly && record.error_message !== undefined ? { error_message: redactArchiveText(record.error_message) } : {}),
    ...(record.killed === true ? { killed: true } : {}),
    ...(!metadataOnly && record.final_response !== undefined ? { final_response: redactArchiveText(record.final_response) } : {}),
    ...(record.run_stats !== undefined ? { run_stats: record.run_stats } : {}),
    tool_call_count: toolEvents.length,
    tool_error_count: toolErrorCount,
    ...(record.owner?.kind === "dag" ? { dag_run_id: record.owner.runId, dag_node_id: record.owner.nodeId } : {}),
    retained_because: input.selection.reason,
    content_retention: metadataOnly ? "metadata-only" : "full",
    ...(input.selection.protected_by_path ? { protected_by_path: true } : {}),
    redaction: ARCHIVE_REDACTION_ID,
    transcript_event_count: input.events.length,
    ...(bounded !== undefined ? { transcript_truncated: bounded.truncated } : {}),
    archived_at: input.archivedAt,
  }
}

type NumberedEntry = { readonly entry: ArchiveEntry; readonly bytes: number }

function transcriptEntriesOf(input: ComposeTaskArchiveInput): readonly ArchiveEntry[] {
  const { record } = input
  const entries: ArchiveEntry[] = []
  const spec = record.spawn_spec
  const prompt = spec !== undefined && isSpawnSpecV1(spec) ? spec.prompt : undefined
  if (prompt !== undefined && prompt.length > 0) {
    entries.push(messageEntry(0, terminalAt(record), "user", redactArchiveText(prompt)))
  }
  for (const event of input.events) {
    const entry = eventEntry(entries.length, terminalAt(record), event)
    if (entry !== undefined) entries.push(entry)
  }
  return entries
}

function messageEntry(index: number, timestamp: string, role: string, text: string): ArchiveEntry {
  return {
    type: "message",
    id: entryId(index),
    timestamp,
    message: { role, content: [{ type: "text", text }] },
  }
}

function eventEntry(index: number, timestamp: string, event: PersistedTaskEvent): ArchiveEntry | undefined {
  const payload = isRecord(event.payload) ? event.payload : {}
  if (event.type === "assistant_message" && typeof payload.text === "string") {
    return messageEntry(index, timestamp, "assistant", redactArchiveText(payload.text))
  }
  const customType = customTypeOf(event.type)
  if (customType === undefined) return undefined
  return {
    type: "custom",
    id: entryId(index),
    timestamp,
    customType,
    data: redactArchiveValue(payload) as Record<string, unknown>,
  }
}

function customTypeOf(eventType: string): string | undefined {
  switch (eventType) {
    case "tool_execution":
      return TASK_TOOL_CUSTOM_TYPE
    case "child_error":
      return TASK_ERROR_CUSTOM_TYPE
    case "team_message_waited":
      return TASK_TEAM_MESSAGE_CUSTOM_TYPE
    case "retry_fallback_applied":
    case "retry_fallback_exhausted":
      return TASK_FALLBACK_CUSTOM_TYPE
    default:
      return undefined
  }
}

function entryId(index: number): string {
  return index.toString(16).padStart(8, "0")
}

// Keep whole head+tail entries within the byte budget so a valid JSONL document always results.
// At least one head and one tail entry survive even when a single entry exceeds the budget, so
// truncation never degenerates into an empty transcript.
function boundToBudget(
  entries: readonly ArchiveEntry[],
  maxBytes: number,
): { readonly entries: readonly ArchiveEntry[]; readonly count: number; readonly truncated: boolean } {
  const numbered: readonly NumberedEntry[] = entries.map((entry) => ({ entry, bytes: Buffer.byteLength(JSON.stringify(entry), "utf8") + 1 }))
  const total = numbered.reduce((sum, item) => sum + item.bytes, 0)
  if (total <= maxBytes) return { entries, count: entries.length, truncated: false }

  const halfBudget = Math.floor(maxBytes / 2)
  let headBytes = 0
  let headCount = 0
  for (const item of numbered) {
    if (headCount > 0 && headBytes + item.bytes > halfBudget) break
    headBytes += item.bytes
    headCount += 1
  }
  let tailBytes = 0
  let tailCount = 0
  for (let index = numbered.length - 1; index >= headCount; index -= 1) {
    const item = numbered[index]
    if (item === undefined) break
    if (tailCount > 0 && tailBytes + item.bytes > halfBudget) break
    tailBytes += item.bytes
    tailCount += 1
  }
  const kept = [...entries.slice(0, headCount), ...entries.slice(entries.length - tailCount)]
  return { entries: kept, count: entries.length, truncated: true }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
