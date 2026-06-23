import type { DecisionProfile } from "./types"
import type { RecourseLevel } from "./voi-types"

export function classifyRecourse(profile: DecisionProfile): RecourseLevel {
  const name = profile.decision.toLowerCase()
  if (name.includes("wait") || name.includes("defer") || name.includes("phase") || name.includes("monitor")) return "reversible"
  if (profile.catastrophicGated) return "irreversible"
  if (name.includes("grounding_total") || name.includes("shutdown") || name.includes("rollback")) return "partially_reversible"
  return "partially_reversible"
}
