import fs from "node:fs"
import path from "node:path"
import { getUserConfigDir, log } from "../../shared"

const STATE_FILE_NAME = "omo-onboarding.state.json"

export function getOmoOnboardingStatePath(): string {
  return path.join(getUserConfigDir(), "opencode", "oh-my-opencode", STATE_FILE_NAME)
}

export function loadPersistedOmoOnboardingShown(): boolean {
  try {
    const filePath = getOmoOnboardingStatePath()
    if (!fs.existsSync(filePath)) return false
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw) as { shown?: unknown } | undefined
    return parsed?.shown === true
  } catch (err) {
    log("[omo-onboarding] failed to load persisted state", {
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

export function persistOmoOnboardingShown(shown: boolean): void {
  try {
    const filePath = getOmoOnboardingStatePath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(
      filePath,
      JSON.stringify({ shown, updatedAt: new Date().toISOString() }, null, 2) + "\n",
      "utf8",
    )
  } catch (err) {
    log("[omo-onboarding] failed to persist state", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

