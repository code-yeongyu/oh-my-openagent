import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  findProjectAgentsSkillDirs,
  findProjectClaudeSkillDirs,
  findProjectOpencodeCommandDirs,
  findProjectOpencodeSkillDirs,
} from "./project-discovery-dirs"

const TEST_DIR = join(tmpdir(), `project-discovery-dirs-${Date.now()}`)

function canonicalPath(path: string): string {
  return realpathSync(path)
}

describe("project-discovery-dirs", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("#given nested .opencode skill directories #when finding project opencode skill dirs #then returns nearest-first with aliases", () => {
    // given
    const projectDir = join(TEST_DIR, "project")
    const childDir = join(projectDir, "apps", "cli")
    mkdirSync(join(projectDir, ".opencode", "skill"), { recursive: true })
    mkdirSync(join(projectDir, ".opencode", "skills"), { recursive: true })
    mkdirSync(join(TEST_DIR, ".opencode", "skills"), { recursive: true })

    // when
    const directories = findProjectOpencodeSkillDirs(childDir)

    // then
    expect(directories).toEqual([
      canonicalPath(join(projectDir, ".opencode", "skills")),
      canonicalPath(join(projectDir, ".opencode", "skill")),
      canonicalPath(join(TEST_DIR, ".opencode", "skills")),
    ])
  })

  it("#given nested .opencode command directories #when finding project opencode command dirs #then returns nearest-first with aliases", () => {
    // given
    const projectDir = join(TEST_DIR, "project")
    const childDir = join(projectDir, "packages", "tool")
    mkdirSync(join(projectDir, ".opencode", "commands"), { recursive: true })
    mkdirSync(join(TEST_DIR, ".opencode", "command"), { recursive: true })

    // when
    const directories = findProjectOpencodeCommandDirs(childDir)

    // then
    expect(directories).toEqual([
      canonicalPath(join(projectDir, ".opencode", "commands")),
      canonicalPath(join(TEST_DIR, ".opencode", "command")),
    ])
  })

  it("#given ancestor claude and agents skill directories #when finding project compatibility dirs #then discovers both scopes", () => {
    // given
    const projectDir = join(TEST_DIR, "project")
    const childDir = join(projectDir, "src", "nested")
    mkdirSync(join(projectDir, ".claude", "skills"), { recursive: true })
    mkdirSync(join(TEST_DIR, ".agents", "skills"), { recursive: true })

    // when
    const claudeDirectories = findProjectClaudeSkillDirs(childDir)
    const agentsDirectories = findProjectAgentsSkillDirs(childDir)

    // then
    expect(claudeDirectories).toEqual([canonicalPath(join(projectDir, ".claude", "skills"))])
    expect(agentsDirectories).toEqual([canonicalPath(join(TEST_DIR, ".agents", "skills"))])
  })

  it("#given a stop directory #when finding ancestor dirs #then it does not scan beyond the stop boundary", () => {
    // given
    const projectDir = join(TEST_DIR, "project")
    const childDir = join(projectDir, "apps", "cli")
    mkdirSync(join(projectDir, ".opencode", "skills"), { recursive: true })
    mkdirSync(join(TEST_DIR, ".opencode", "skills"), { recursive: true })

    // when
    const directories = findProjectOpencodeSkillDirs(childDir, projectDir)

    // then
    expect(directories).toEqual([canonicalPath(join(projectDir, ".opencode", "skills"))])
  })
})
