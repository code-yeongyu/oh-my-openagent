import { existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import type { BoulderState } from "./types"
import { BOULDER_DIR, BOULDER_FILE, BOULDER_PLANS_DIR } from "./constants"
import { parseBoulderJson } from "./boulder-json-parser"
import { writeBoulderStateForPlan, readBoulderStateForPlan } from "./per-plan-storage"

function getLegacyFilePath(directory: string): string {
  return join(directory, BOULDER_DIR, BOULDER_FILE)
}


/**
 * Migrate legacy singleton boulder.json to per-plan storage.
 * Returns the migrated state if migration occurred, null otherwise.
 */
export function migrateLegacyBoulderState(directory: string): BoulderState | null {
  const legacyPath = getLegacyFilePath(directory)

  if (!existsSync(legacyPath)) return null

  const state = parseBoulderJson(legacyPath)
  if (!state || !state.plan_name) return null

  // Check if this specific plan has already been migrated
  if (readBoulderStateForPlan(directory, state.plan_name)) return null

  const written = writeBoulderStateForPlan(directory, state.plan_name, state)
  if (!written) return null

  try {
    unlinkSync(legacyPath)
  } catch {
    // non-critical: legacy file remains but per-plan state is written
  }

  return state
}
