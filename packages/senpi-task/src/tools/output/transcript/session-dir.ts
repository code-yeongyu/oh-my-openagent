import { readdirSync } from "node:fs"
import { join } from "node:path"

import type { TranscriptEntry, TranscriptReadResult } from "../types"
import { MAX_TRANSCRIPT_SOURCE_BYTES, readBoundedFileText } from "./read-bounded"
import { parseSessionTranscript } from "./session-jsonl"

// Where the rpc child writes its own senpi session JSONL. Mirrors the launch layout: the manager
// nests each child under children/<taskId>, and the rpc spawn isolates the session under
// sessions/<taskId> (runners/rpc/spawn.ts resolveChildSessionDir). READ-ONLY: task_output never
// writes here and only ever touches OUR own state dir, never another project's.
export function childSessionDir(stateDir: string, taskId: string): string {
  return join(stateDir, "children", taskId, "sessions", taskId)
}

// Reconstruct a child's transcript from its persisted senpi session file(s). Multiple files (one per
// session turn) are read in name order and concatenated. A missing dir is an empty transcript.
export function readSessionDirTranscript(stateDir: string, taskId: string): readonly TranscriptEntry[] {
  return readSessionDirTranscriptResult(stateDir, taskId).entries
}

export function readSessionDirTranscriptResult(stateDir: string, taskId: string): TranscriptReadResult {
  const dir = childSessionDir(stateDir, taskId)
  const files = listJsonl(dir)
  if (files.length === 0) return { entries: [], source: "session-jsonl", truncated: false }
  const selected = files.length <= 2 ? files : [files[0], files.at(-1)].filter((file) => file !== undefined)
  const fileBudget = Math.floor(MAX_TRANSCRIPT_SOURCE_BYTES / selected.length)
  const entries: TranscriptEntry[] = []
  let truncated = selected.length < files.length
  for (const file of selected) {
    const raw = readBoundedFileText(join(dir, file), fileBudget)
    if (raw !== undefined) {
      entries.push(...parseSessionTranscript(raw.text))
      truncated ||= raw.truncated
    }
  }
  return { entries, source: "session-jsonl", truncated }
}

function listJsonl(dir: string): readonly string[] {
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith(".jsonl"))
      .toSorted()
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
}
