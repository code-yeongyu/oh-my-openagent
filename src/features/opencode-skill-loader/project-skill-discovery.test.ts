import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "../../shared/bun-spawn-shim"
import { resolveGitExecutable } from "../../shared/git-executable"
import { detectWorktreePath } from "../../shared/project-discovery-dirs"
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

function runGit(args: string[], cwd: string): void {
  const result = spawnSync([resolveGitExecutable(), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr))
  }
}

function canonicalPath(path: string): string {
  return realpathSync(path)
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
    runGit(["init"], repositoryDir)
    expect(existsSync(join(repositoryDir, ".git"))).toBe(true)
    const gitExecutable = resolveGitExecutable()
    const shellProbe = spawnSync(["/bin/sh", "-c", "printf '%s' probe"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const gitVersionProbe = spawnSync([gitExecutable, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const directRevParse = spawnSync([gitExecutable, "rev-parse", "--show-toplevel"], {
      cwd: nestedDirectory,
      stdout: "pipe",
      stderr: "pipe",
    })
    expect({
      gitExecutable,
      exitCode: directRevParse.exitCode,
      gitVersionOutput: new TextDecoder().decode(gitVersionProbe.stdout).trim().startsWith("git version"),
      shellOutput: new TextDecoder().decode(shellProbe.stdout),
      stderr: new TextDecoder().decode(directRevParse.stderr),
      stdout: new TextDecoder().decode(directRevParse.stdout).trim(),
    }).toEqual({
      gitExecutable,
      exitCode: 0,
      gitVersionOutput: true,
      shellOutput: "probe",
      stderr: "",
      stdout: canonicalPath(repositoryDir),
    })
    expect(detectWorktreePath(nestedDirectory)).toBe(canonicalPath(repositoryDir))

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
