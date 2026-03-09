import type { SkillScope } from "../types"

export const SCOPE_PRIORITY: Record<SkillScope, number> = {
  builtin: 1,
  config: 2,
  plugin: 3,
  user: 4,
  opencode: 5,
  project: 6,
  "opencode-project": 7,
}
