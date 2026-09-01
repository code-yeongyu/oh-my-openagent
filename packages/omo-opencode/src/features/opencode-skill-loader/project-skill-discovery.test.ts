import { execFileSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  discoverOpencodeProjectSkills,
  discoverProjectAgentsSkills,
  discoverProjectClaudeSkills,
} from "./loader"

function writeSkill(directory: string, name: string, description: string): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\nBody\n`,
  )
}

describe("project skill discovery", () => {
  let tempDir = ""

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omo-project-skill-discovery-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("discovers ancestor project skill directories up to the worktree root", async () => {
    // given
    const repositoryDir = join(tempDir, "repo")
    const nestedDirectory = join(repositoryDir, "packages", "app", "src")

    mkdirSync(nestedDirectory, { recursive: true })
    execFileSync("git", ["init"], {
      cwd: repositoryDir,
      stdio: ["ignore", "ignore", "ignore"],
    })

    writeSkill(
      join(repositoryDir, ".claude", "skills", "repo-claude"),
      "repo-claude",
      "Discovered from the repository root",
    )
    writeSkill(
      join(repositoryDir, ".agents", "skills", "repo-agents"),
      "repo-agents",
      "Discovered from the repository root",
    )
    writeSkill(
      join(repositoryDir, ".opencode", "skill", "repo-opencode"),
      "repo-opencode",
      "Discovered from the repository root",
    )

    writeSkill(
      join(tempDir, ".claude", "skills", "outside-claude"),
      "outside-claude",
      "Should stay outside the worktree",
    )
    writeSkill(
      join(tempDir, ".agents", "skills", "outside-agents"),
      "outside-agents",
      "Should stay outside the worktree",
    )
    writeSkill(
      join(tempDir, ".opencode", "skills", "outside-opencode"),
      "outside-opencode",
      "Should stay outside the worktree",
    )

    // when
    const [claudeSkills, agentSkills, opencodeSkills] = await Promise.all([
      discoverProjectClaudeSkills(nestedDirectory),
      discoverProjectAgentsSkills(nestedDirectory),
      discoverOpencodeProjectSkills(nestedDirectory),
    ])

    // then
    expect(claudeSkills.map(skill => skill.name)).toEqual(["repo-claude"])
    expect(agentSkills.map(skill => skill.name)).toEqual(["repo-agents"])
    expect(opencodeSkills.map(skill => skill.name)).toEqual(["repo-opencode"])
  })
})
