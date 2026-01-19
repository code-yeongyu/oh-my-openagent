import fs from "node:fs"
import path from "node:path"
import { getUserConfigDir, log } from "../../shared"

const STATE_FILE_NAME = "memo-anchor.state.json"

export function getMemoAnchorStatePath(): string {
  return path.join(getUserConfigDir(), "opencode", "oh-my-opencode", STATE_FILE_NAME)
}

export function loadPersistedMemoAnchorEnabled(): boolean | undefined {
  try {
    const filePath = getMemoAnchorStatePath()
    if (!fs.existsSync(filePath)) return undefined
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw) as { enabled?: unknown } | undefined
    if (!parsed || typeof parsed.enabled !== "boolean") return undefined
    return parsed.enabled
  } catch (err) {
    log("[memo-anchor] failed to load persisted state", {
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}

export function persistMemoAnchorEnabled(enabled: boolean): void {
  try {
    const filePath = getMemoAnchorStatePath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(
      filePath,
      JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2) + "\n",
      "utf8",
    )
  } catch (err) {
    log("[memo-anchor] failed to persist state", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

