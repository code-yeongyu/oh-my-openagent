import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { OmoGitMasterSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createTaskSkillLoader, packagedSkillDirs } from "./task-skill-loader"

const CO_AUTHOR_TRAILER = "Co-authored-by: sisyphus-dev-ai <sisyphus-dev-ai@users.noreply.github.com>"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-task-skill-loader-"))
  roots.push(root)
  return root
}

function writeSkill(root: string, body: string, name = "shared"): void {
  const skillDir = join(root, name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} test skill\n---\n${body}\n`,
  )
}

describe("packagedSkillDirs", () => {
  test("#given the source-tree layout #when packaged dirs resolve #then load_skills [\"x-search\"] resolves from plugin/skills-conditional", () => {
    // given
    const root = tempDir()
    const moduleDir = join(root, "packages", "omo-senpi", "src", "components", "task")
    mkdirSync(moduleDir, { recursive: true })
    const conditionalDir = join(root, "packages", "omo-senpi", "plugin", "skills-conditional")
    writeSkill(conditionalDir, "SOURCE TREE X SEARCH BODY", "x-search")

    // when
    const dirs = packagedSkillDirs(pathToFileURL(join(moduleDir, "task-skill-loader.ts")).href)
    const loader = createTaskSkillLoader({
      agentDir: tempDir(),
      homeDir: tempDir(),
      pluginSkillsDirs: dirs,
      loadSettings: () => OmoGitMasterSettingsSchema.parse({}),
    })
    const resolution = loader(["x-search"], tempDir())

    // then
    expect(dirs).toContain(conditionalDir)
    expect(resolution.resolved).toEqual(["x-search"])
    expect(resolution.prepend).toContain("SOURCE TREE X SEARCH BODY")
  })

  test("#given the bundled runtime layout #when packaged dirs resolve #then load_skills [\"x-search\"] resolves from ../skills-conditional", () => {
    // given
    const root = tempDir()
    const moduleDir = join(root, "plugin", "extensions")
    mkdirSync(moduleDir, { recursive: true })
    const conditionalDir = join(root, "plugin", "skills-conditional")
    writeSkill(conditionalDir, "BUNDLED X SEARCH BODY", "x-search")

    // when
    const dirs = packagedSkillDirs(pathToFileURL(join(moduleDir, "omo.js")).href)
    const loader = createTaskSkillLoader({
      agentDir: tempDir(),
      homeDir: tempDir(),
      pluginSkillsDirs: dirs,
      loadSettings: () => OmoGitMasterSettingsSchema.parse({}),
    })
    const resolution = loader(["x-search"], tempDir())

    // then
    expect(dirs).toContain(conditionalDir)
    expect(resolution.resolved).toEqual(["x-search"])
    expect(resolution.prepend).toContain("BUNDLED X SEARCH BODY")
  })
})

describe("createTaskSkillLoader", () => {
  test("#given canonical and packaged skill roots #when the loader resolves a collision #then canonical wins", () => {
    const cwd = tempDir()
    const agentDir = tempDir()
    const pluginSkillsDir = tempDir()
    writeSkill(join(agentDir, "skills"), "CANONICAL BODY")
    writeSkill(pluginSkillsDir, "PACKAGED BODY")

    const loader = createTaskSkillLoader({
      agentDir,
      homeDir: tempDir(),
      pluginSkillsDirs: [pluginSkillsDir],
    })
    const resolution = loader(["shared"], cwd)

    expect(resolution.resolved).toEqual(["shared"])
    expect(resolution.prepend).toContain("CANONICAL BODY")
    expect(resolution.prepend).not.toContain("PACKAGED BODY")
  })

  test("#given default attribution settings #when the git-master skill is loaded #then the co-author directive rides the skill block", () => {
    const cwd = tempDir()
    const pluginSkillsDir = tempDir()
    writeSkill(pluginSkillsDir, "GIT MASTER BODY", "git-master")

    const loader = createTaskSkillLoader({
      agentDir: tempDir(),
      homeDir: tempDir(),
      pluginSkillsDirs: [pluginSkillsDir],
      loadSettings: () => OmoGitMasterSettingsSchema.parse({}),
    })
    const resolution = loader(["git-master"], cwd)

    expect(resolution.resolved).toEqual(["git-master"])
    expect(resolution.prepend).toContain("GIT MASTER BODY")
    expect(resolution.prepend).toContain(CO_AUTHOR_TRAILER)
  })

  test("#given attribution disabled #when the git-master skill is loaded #then the skill block stays untouched", () => {
    const cwd = tempDir()
    const pluginSkillsDir = tempDir()
    writeSkill(pluginSkillsDir, "GIT MASTER BODY", "git-master")

    const loader = createTaskSkillLoader({
      agentDir: tempDir(),
      homeDir: tempDir(),
      pluginSkillsDirs: [pluginSkillsDir],
      loadSettings: () =>
        OmoGitMasterSettingsSchema.parse({ commit_footer: false, include_co_authored_by: false }),
    })
    const resolution = loader(["git-master"], cwd)

    expect(resolution.prepend).toContain("GIT MASTER BODY")
    expect(resolution.prepend).not.toContain(CO_AUTHOR_TRAILER)
    expect(resolution.prepend).not.toContain("Ultraworked with")
  })

  test("#given default attribution settings #when a non-git-master skill is loaded #then no directive is injected", () => {
    const cwd = tempDir()
    const pluginSkillsDir = tempDir()
    writeSkill(pluginSkillsDir, "SHARED BODY")

    const loader = createTaskSkillLoader({
      agentDir: tempDir(),
      homeDir: tempDir(),
      pluginSkillsDirs: [pluginSkillsDir],
      loadSettings: () => OmoGitMasterSettingsSchema.parse({}),
    })
    const resolution = loader(["shared"], cwd)

    expect(resolution.prepend).toContain("SHARED BODY")
    expect(resolution.prepend).not.toContain(CO_AUTHOR_TRAILER)
  })
})
