/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const PROJECT_ROOT = fileURLToPath(new URL("../../..", import.meta.url))

async function readProjectSkill(...segments: string[]) {
  return Bun.file(join(PROJECT_ROOT, ".opencode", "skills", ...segments, "SKILL.md")).text()
}

describe("project skill tool references", () => {
  describe("#given work-with-pr skill instructions", () => {
    test("#when reading the commit delegation example #then it uses a real task category", async () => {
      const skillContent = await readProjectSkill("work-with-pr")

      const usesQuickCategory = skillContent.includes(
        'task(category="quick", load_skills=["git-master"], prompt="Commit the changes atomically following git-master conventions. Repository is at {WORKTREE_PATH}.")'
      )

      expect(usesQuickCategory).toBe(true)
      expect(skillContent).not.toContain('task(category="git"')
    })
  })

  describe("#given github-triage skill instructions", () => {
    test("#when reading task tracking examples #then they use the real task management tool names", async () => {
      const skillContent = await readProjectSkill("github-triage")

      const usesRealToolNames =
        skillContent.includes("task_create(subject=\"Triage: #{number} {title}\")")
        && skillContent.includes("task_update(id=task_id, status=\"completed\", description=REPORT_SUMMARY)")

      expect(usesRealToolNames).toBe(true)
      expect(skillContent).not.toContain("TaskCreate(")
      expect(skillContent).not.toContain("TaskUpdate(")
    })
  })
})
