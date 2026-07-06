import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { START_WORK_TEMPLATE } from "./start-work"

const repoRoot = join(import.meta.dir, "../../../../../..")

describe("worktree merge-status guard in loaded prompts", () => {
  test("START_WORK_TEMPLATE contains ancestry + dirty guard and lifecycle status", () => {
    expect(START_WORK_TEMPLATE).toContain("git log --oneline <target-branch>..HEAD")
    expect(START_WORK_TEMPLATE).toContain("git status --short")
    expect(START_WORK_TEMPLATE).toContain("already merged")
    expect(START_WORK_TEMPLATE).toContain("local-only")
    expect(START_WORK_TEMPLATE).toContain("worktree-only dirty changes remain")
  })

  test("both work-with-pr SKILL copies contain worktree lifecycle guard and are byte-identical", () => {
    const agentsPath = join(repoRoot, ".agents/skills/work-with-pr/SKILL.md")
    const opencodePath = join(repoRoot, ".opencode/skills/work-with-pr/SKILL.md")
    const agentsContent = readFileSync(agentsPath, "utf8")
    const opencodeContent = readFileSync(opencodePath, "utf8")

    // Both must contain the guard
    for (const content of [agentsContent, opencodeContent]) {
      expect(content).toContain('git -C "$WORKTREE_PATH" log --oneline "$BASE_BRANCH"..HEAD')
      expect(content).toContain('git -C "$WORKTREE_PATH" status --short')
      expect(content).toContain("local-only")
      expect(content).toContain("Worktree lifecycle")
    }

    // Byte-identical
    expect(agentsContent).toBe(opencodeContent)
  })

  test("shared start-work SKILL.md contains ancestry + dirty guard", () => {
    const skillPath = join(repoRoot, "packages/shared-skills/skills/start-work/SKILL.md")
    const content = readFileSync(skillPath, "utf8")

    expect(content).toContain("git status --short")
    expect(content).toContain("git log --oneline <target-branch>..HEAD")
    expect(content).toContain("Commit ancestry alone")
  })

  test("start-work-continuation directive.md contains worktree lifecycle status and git status --short", () => {
    const directivePath = join(repoRoot, "packages/omo-codex/plugin/components/start-work-continuation/directive.md")
    const content = readFileSync(directivePath, "utf8")

    expect(content).toContain("worktree lifecycle status")
    expect(content).toContain("git status --short")
  })

  test("sync-skills.mjs contains git status --short in both start-work completion constants", () => {
    const syncPath = join(repoRoot, "packages/omo-codex/plugin/scripts/sync-skills.mjs")
    const content = readFileSync(syncPath, "utf8")

    // The guard must appear in both the original and Codex completion constants
    // so sync output cannot drop the guard.
    const originalStart = content.indexOf("startWorkOriginalCompletion")
    const codexStart = content.indexOf("startWorkCodexCompletion")
    expect(originalStart).toBeGreaterThan(-1)
    expect(codexStart).toBeGreaterThan(originalStart)

    const originalSection = content.slice(originalStart, codexStart)
    const codexSection = content.slice(codexStart)

    expect(originalSection).toContain("git status --short")
    expect(codexSection).toContain("git status --short")
  })
})
