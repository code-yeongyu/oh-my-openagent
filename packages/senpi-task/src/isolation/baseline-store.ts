import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type { WorktreeBaseline } from "./runtime"

export function isolationArtifactsDir(stateDir: string, taskId: string): string {
  return join(stateDir, "isolation", taskId)
}

export function baselinePath(stateDir: string, taskId: string): string {
  return join(isolationArtifactsDir(stateDir, taskId), "baseline.json")
}

/**
 * The baseline is the ONLY way a later process can tell the child's work from the parent's: a host
 * that dies mid-run leaves no memory, so the salvage pass reads it back off disk.
 */
export function writeBaseline(stateDir: string, taskId: string, baseline: WorktreeBaseline): string {
  const path = baselinePath(stateDir, taskId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(baseline), "utf8")
  return path
}

export function readBaseline(stateDir: string, taskId: string): WorktreeBaseline | null {
  try {
    return JSON.parse(readFileSync(baselinePath(stateDir, taskId), "utf8")) as WorktreeBaseline
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}
