/**
 * Boulder State Archive
 *
 * Archives completed plans with YAML frontmatter metadata.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { BoulderState } from "./types"
import type { SisyphusAgentConfig } from "../../config/schema"
import { ARCHIVE_BASE_PATH } from "./constants"
import { getPlanProgress, clearBoulderState } from "./storage"

export function archiveCompletedPlan(
  directory: string,
  boulderState: BoulderState,
  config: SisyphusAgentConfig
): boolean {
  if (config.archive_completed_plans === false) {
    return false
  }

   const progress = getPlanProgress(boulderState.active_plan)
   if (progress.total === 0 || !progress.isComplete) {
     return false
   }

  if (!existsSync(boulderState.active_plan)) {
    return false
  }

  let planContent: string
  try {
    planContent = readFileSync(boulderState.active_plan, "utf-8")
  } catch {
    return false
  }

  const completedAt = new Date().toISOString()
  const sessionCount = boulderState.session_ids.length
  const totalTasks = progress.total
  const durationHours = (Date.parse(completedAt) - Date.parse(boulderState.started_at)) / 3600000

  const frontmatter = `---
completed_at: ${completedAt}
session_count: ${sessionCount}
total_tasks: ${totalTasks}
duration_hours: ${durationHours.toFixed(2)}
---

`

  const archiveDir = config.archive_path || join(directory, ARCHIVE_BASE_PATH)
  const baseArchivePath = join(archiveDir, `${boulderState.plan_name}.md`)
  let archivePath = baseArchivePath

  if (existsSync(baseArchivePath)) {
    // Check if the existing archive has the same content (idempotency)
    const existingContent = readFileSync(baseArchivePath, "utf-8")
    const newContent = frontmatter + planContent
    
    if (existingContent === newContent) {
      // Same content, it's idempotent
      clearBoulderState(directory)
      return true
    }
    
    // Different content, it's a collision - create timestamped file
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    archivePath = join(archiveDir, `${boulderState.plan_name}-${timestamp}.md`)
  }

  if (existsSync(archivePath)) {
    clearBoulderState(directory)
    return true
  }

  try {
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true })
    }
  } catch {
    return false
  }

  try {
    writeFileSync(archivePath, frontmatter + planContent, "utf-8")
  } catch {
    return false
  }

  clearBoulderState(directory)
  return true
}
