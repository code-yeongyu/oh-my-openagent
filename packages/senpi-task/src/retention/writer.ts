import { createHash } from "node:crypto"
import { gunzipSync, gzipSync } from "node:zlib"
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { OmoTaskTranscriptRetention } from "@oh-my-opencode/omo-config-core"

import type { TaskRecord } from "../state"
import { readBoundedFileText } from "../tools/output/transcript/read-bounded"
import type { PersistedTaskEvent, TaskRecordStore } from "../store"
import { composeTaskArchiveContentJsonl, composeTaskArchiveManifestJsonl, type ArchiveContentFacts } from "./archive"
import { selectForTranscriptRetention } from "./selection"

const EVENT_LOG_MAX_BYTES = 4_000_000
const ARCHIVE_DIR_MODE = 0o700
const ARCHIVE_FILE_MODE = 0o600
// Suffixes of every artifact this writer produces; expiry removes any file it recognizes.
const ARCHIVE_SUFFIXES: ReadonlySet<string> = new Set([".jsonl", ".jsonl.gz"])

export type TranscriptArchiveWriter = {
  // Archive one terminal task if it is selected: the manifest session JSONL (finder-discoverable,
  // metadata + pointer) and, for full retention, the gzip-compressed content sidecar. A no-op for
  // unselected tasks. Throws on I/O failure so the caller (the TTL sweep) can log without blocking
  // cleanup.
  readonly archiveRecord: (record: TaskRecord) => void
  // Remove archive artifacts whose mtime predates the retention TTL. Returns removed file names.
  readonly expireExpired: () => readonly string[]
}

export function createTranscriptArchiveWriter(input: {
  readonly stateDir: string
  readonly archiveDir: string
  readonly settings: OmoTaskTranscriptRetention
  readonly now: () => number
  readonly archiveId?: () => string
}): TranscriptArchiveWriter {
  const { settings } = input

  return {
    archiveRecord(record) {
      const selection = selectForTranscriptRetention(settings, record)
      if (selection === undefined) return
      const events = readEventLog(input.stateDir, record.task_id)
      const newArchiveId = input.archiveId ?? (() => crypto.randomUUID())
      const composeInput = {
        record,
        events,
        settings,
        archiveId: newArchiveId(),
        archivedAt: new Date(input.now()).toISOString(),
        selection,
      }
      const base = archiveBaseName(record.terminal_at ?? record.updated_at, record.task_id)
      let facts: ArchiveContentFacts | undefined
      if (selection.mode === "full") {
        const content = composeTaskArchiveContentJsonl(composeInput)
        // Deterministic gzip: node writes a zeroed MTIME header field when no mtime option is
        // given and embeds no file name, so re-archiving the same task produces byte-identical
        // files and archive contents are reproducible for audit.
        const compressed = gzipSync(content.text, { level: 9 })
        writeArchiveFile(input.archiveDir, `${base}.jsonl.gz`, compressed)
        facts = {
          file: `${base}.jsonl.gz`,
          sha256: createHash("sha256").update(compressed).digest("hex"),
          compressed_bytes: compressed.byteLength,
          uncompressed_bytes: Buffer.byteLength(content.text, "utf8"),
          transcript_truncated: content.truncated,
        }
      }
      const manifest = composeTaskArchiveManifestJsonl(composeInput, facts)
      writeArchiveFile(input.archiveDir, `${base}.jsonl`, manifest)
    },
    expireExpired() {
      const cutoff = input.now() - settings.ttl_ms
      const removed: string[] = []
      let files: readonly string[]
      try {
        files = readdirSync(input.archiveDir)
      } catch (error) {
        if (isEnoent(error)) return removed
        throw error
      }
      for (const file of files) {
        if (![...ARCHIVE_SUFFIXES].some((suffix) => file.endsWith(suffix))) continue
        const path = join(input.archiveDir, file)
        if (statSync(path).mtimeMs >= cutoff) continue
        rmSync(path, { force: true })
        removed.push(file)
      }
      return removed.toSorted()
    },
  }
}

function writeArchiveFile(archiveDir: string, name: string, bytes: string | Buffer): void {
  mkdirSync(archiveDir, { recursive: true, mode: ARCHIVE_DIR_MODE })
  const path = join(archiveDir, name)
  // Deterministic name: a re-archive of the same task overwrites in place instead of
  // duplicating. Mode applies at creation; the restrictive mode is the point.
  writeFileSync(path, bytes, { flag: "w", mode: ARCHIVE_FILE_MODE })
}

// Decompress a content sidecar written by this module (QA + audit readers).
export function readArchiveContent(gzipBytes: Buffer): string {
  return gunzipSync(gzipBytes).toString("utf8")
}

// Senpi session files are named <timestamp>_<id>.jsonl with the ISO timestamp's colons and the
// millisecond dot replaced by dashes; archives mirror that so name-order sorting matches
// time-order in every existing session listing. The compressed sidecar appends .gz to the same
// base name so a manifest pointer and its content always sort adjacently.
export function archiveFileName(terminalAt: string, taskId: string): string {
  return `${archiveBaseName(terminalAt, taskId)}.jsonl`
}

function archiveBaseName(terminalAt: string, taskId: string): string {
  return `${terminalAt.replace(/[:.]/g, "-")}_${taskId}`
}

function readEventLog(stateDir: string, taskId: string): readonly PersistedTaskEvent[] {
  const raw = readBoundedFileText(join(stateDir, "logs", `${taskId}.jsonl`), EVENT_LOG_MAX_BYTES)
  if (raw === undefined) return []
  const events: PersistedTaskEvent[] = []
  for (const line of raw.text.split("\n")) {
    if (line.trim().length === 0) continue
    try {
      const value: unknown = JSON.parse(line)
      if (isEvent(value)) events.push(value)
    } catch (error) {
      if (error instanceof SyntaxError) continue
      throw error
    }
  }
  return events
}

function isEvent(value: unknown): value is PersistedTaskEvent {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
