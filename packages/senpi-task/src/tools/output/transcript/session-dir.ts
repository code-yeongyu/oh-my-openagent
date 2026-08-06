import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { TranscriptEntry } from "../types"
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
  const dir = childSessionDir(stateDir, taskId)
  const files = listJsonl(dir)
  const entries: TranscriptEntry[] = []
  for (const file of files) {
    const raw = readFileSafe(join(dir, file))
    if (raw !== undefined) entries.push(...parseSessionTranscript(raw))
  }
  return entries
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

function readFileSafe(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}
