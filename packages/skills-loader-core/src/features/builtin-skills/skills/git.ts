import type { BuiltinSkill } from "../types"

import { GIT_SKILL_DESCRIPTION, GIT_SKILL_NAME } from "./git-skill-metadata"
import { GIT_MASTER_COMMIT_WORKFLOW_SECTION } from "./git-master-sections/commit-workflow"
import { GIT_MASTER_HISTORY_SEARCH_WORKFLOW_SECTION } from "./git-master-sections/history-search-workflow"
import { GIT_MASTER_OVERVIEW_SECTION } from "./git-master-sections/overview"
import { GIT_MASTER_QUICK_REFERENCE_SECTION } from "./git-master-sections/quick-reference"
import { GIT_MASTER_REBASE_WORKFLOW_SECTION } from "./git-master-sections/rebase-workflow"

const GIT_MASTER_TEMPLATE = [
  GIT_MASTER_OVERVIEW_SECTION,
  GIT_MASTER_COMMIT_WORKFLOW_SECTION,
  "---\n---",
  GIT_MASTER_REBASE_WORKFLOW_SECTION,
  "---\n---",
  GIT_MASTER_HISTORY_SEARCH_WORKFLOW_SECTION,
  "---",
  GIT_MASTER_QUICK_REFERENCE_SECTION,
].join("\n\n")

export const gitSkill: BuiltinSkill = {
  name: GIT_SKILL_NAME,
  description: GIT_SKILL_DESCRIPTION,
  template: GIT_MASTER_TEMPLATE,
}
