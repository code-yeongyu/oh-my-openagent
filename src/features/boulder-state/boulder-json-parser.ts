import { existsSync, readFileSync } from "node:fs"
import type { BoulderState } from "./types"

export function parseBoulderJson(filePath: string): BoulderState | null {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    if (!Array.isArray(parsed.session_ids)) {
      parsed.session_ids = []
    }
    return parsed as BoulderState
  } catch {
    return null
  }
}
