import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"
import { log } from "../../shared"
import {
  CONSTRUCT_INDICATORS,
  PHASE_TRANSITION_PATTERN,
} from "./constants"

export type MessagePart = { type: string; text?: string }

export function extractPromptText(parts: MessagePart[]): string {
  return parts
    .filter((p) => p.type === "text" && p.text !== undefined)
    .map((p) => p.text ?? "")
    .join(" ")
}

export function hasPhaseTransition(text: string): boolean {
  return PHASE_TRANSITION_PATTERN.test(text)
}

export function findMostRecentPlanFile(plansDir: string): string | null {
  let entries: string[]
  try {
    entries = readdirSync(plansDir).filter((f) => f.endsWith(".md"))
  } catch {
    return null
  }

  if (entries.length === 0) return null

  let mostRecent: { path: string; mtime: number } | null = null
  for (const entry of entries) {
    const fullPath = join(plansDir, entry)
    try {
      const stats = statSync(fullPath)
      if (!stats.isFile()) continue
      if (!mostRecent || stats.mtimeMs > mostRecent.mtime) {
        mostRecent = { path: fullPath, mtime: stats.mtimeMs }
      }
    } catch (err) {
      log(`[design-intent-preserver] stat failed`, { fullPath, error: err })
    }
  }

  return mostRecent?.path ?? null
}

export function planHasConstruct(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, "utf-8")
    return CONSTRUCT_INDICATORS.test(content)
  } catch (err) {
    log(`[design-intent-preserver] read failed`, { filePath, error: err })
    return false
  }
}
