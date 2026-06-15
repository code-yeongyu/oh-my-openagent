import type { SkillScope } from "../types"

export const SCOPE_PRIORITY: Record<SkillScope, number> = {
  builtin: 1,
  config: 2,
  user: 3,
  opencode: 4,
  project: 5,
  "opencode-project": 6,
}
