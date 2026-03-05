import * as os from "node:os"
import * as path from "node:path"

export const HOOK_NAME = "execution-gate"

export const VAULT_ROOT = path.join(
  os.homedir(),
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/Mind Palace",
)

export const DECISION_JOURNAL_PATH = path.join(VAULT_ROOT, "AI/_state/decision-journal.jsonl")
export const FLIGHT_PLAN_PATH = path.join(VAULT_ROOT, "AI/_state/flight-plan.json")
export const CORRECTION_INDEX_PATH = path.join(VAULT_ROOT, "AI/_state/correction-index.json")

export const MAX_INJECTION_CHARS = 4000

export const DEFAULT_SKIP_AGENTS = [
  "explore",
  "librarian",
  "multimodal-looker",
]
