/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

function __repoRootFrom(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error("repo root sentinel not found")
    dir = parent
  }
}

const PROJECT_ROOT = __repoRootFrom(dirname(fileURLToPath(import.meta.url)))

async function readProjectSkill(...segments: string[]) {
  return Bun.file(join(PROJECT_ROOT, ".opencode", "skills", ...segments, "SKILL.md")).text()
}

describe("project skill tool references", () => {
  describe("#given work-with-pr skill instructions", () => {
    test("#when reading the commit guidance #then commits delegate through git-master without a fabricated task category", async () => {
      const skillContent = await readProjectSkill("work-with-pr")

      const delegatesThroughGitMaster = skillContent.includes("commits through `git-master`")

      expect(delegatesThroughGitMaster).toBe(true)
      expect(skillContent).not.toContain(
        'task(category="quick", load_skills=["git-master"], prompt="Commit the changes atomically following git-master conventions. Repository is at {WORKTREE_PATH}.")'
      )
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
