import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { OmoGitMasterSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createTaskSkillLoader, packagedSkillDirs } from "./task-skill-loader"

const TRAILER = "Co-authored-by: sisyphus-dev-ai <sisyphus-dev-ai@users.noreply.github.com>"
const CO_AUTHOR_TRAILER_PATTERN = /Co-authored-by:/i

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

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
  writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} test skill\n---\n${body}\n`)
}

describe("packagedSkillDirs", () => {
  test('#given the source-tree layout #when packaged dirs resolve #then load_skills ["x-search"] resolves from plugin/skills-conditional', () => {
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

  test('#given the bundled runtime layout #when packaged dirs resolve #then load_skills ["x-search"] resolves from ../skills-conditional', () => {
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

  function gitLoader(pluginSkillsDir: string, settings: Record<string, unknown> = {}) {
    return createTaskSkillLoader({
      agentDir: tempDir(),
      homeDir: tempDir(),
      pluginSkillsDirs: [pluginSkillsDir],
      loadSettings: () => OmoGitMasterSettingsSchema.parse(settings),
    })
  }

  test("#given default settings #when load_skills names git and then the legacy git-master alias #then both resolve to git with one settings block and one attribution directive", () => {
    const cwd = tempDir()
    const pluginSkillsDir = tempDir()
    writeSkill(pluginSkillsDir, "GIT BODY", "git")
    const loader = gitLoader(pluginSkillsDir)

    const byName = loader(["git"], cwd)
    const byAlias = loader(["git-master"], cwd)

    expect(byName.resolved).toEqual(["git"])
    expect(byAlias.resolved).toEqual(["git"])
    expect(byAlias.missing).toEqual([])
    expect(byAlias.prepend).toBe(byName.prepend)
    expect(occurrences(byName.prepend, "<git_env_prefix>")).toBe(1)
    expect(occurrences(byName.prepend, "<commit_attribution>")).toBe(1)
    expect(occurrences(byName.prepend, `--trailer "${TRAILER}"`)).toBe(1)
  })

  test("#given a custom git_env_prefix #when the git skill is loaded #then the configured assignments reach both the Bun.$ env form and the bash line form", () => {
    const cwd = tempDir()
    const pluginSkillsDir = tempDir()
    writeSkill(pluginSkillsDir, "GIT BODY", "git")

    const resolution = gitLoader(pluginSkillsDir, { git_env_prefix: "OMO_GIT=7 TRACE_GIT=on" })(["git-master"], cwd)

    expect(resolution.prepend).toContain('OMO_GIT: "7"')
    expect(resolution.prepend).toContain('TRACE_GIT: "on"')
    expect(resolution.prepend).toContain("OMO_GIT=7 TRACE_GIT=on git")
    expect(resolution.prepend).not.toContain("GIT_MASTER")
  })

  test("#given a git skill file that already carries the attribution directive #when it is loaded #then the directive is not appended again", () => {
    const cwd = tempDir()
    const pluginSkillsDir = tempDir()
    writeSkill(pluginSkillsDir, "GIT BODY", "git")
    const firstSkill = gitLoader(pluginSkillsDir, { git_env_prefix: "" })(["git"], cwd).skills?.find(
      (skill) => skill.name === "git",
    )
    const savedDir = tempDir()
    writeSkill(savedDir, firstSkill?.content ?? "", "git")

    const resolution = gitLoader(savedDir, { git_env_prefix: "" })(["git"], cwd)

    expect(occurrences(resolution.prepend, "<commit_attribution>")).toBe(1)
  })

  test("#given the footer opted in #when the git skill is loaded #then the footer and the co-author ride the skill block", () => {
    const cwd = tempDir()
    const pluginSkillsDir = tempDir()
    writeSkill(pluginSkillsDir, "GIT BODY", "git")

    const resolution = gitLoader(pluginSkillsDir, { commit_footer: true, include_co_authored_by: true })(["git"], cwd)

    expect(resolution.prepend).toContain("Ultraworked with")
    expect(occurrences(resolution.prepend, `--trailer "${TRAILER}"`)).toBe(1)
  })

  test("#given attribution and the env prefix disabled #when the git skill is loaded #then the skill block stays untouched", () => {
    const cwd = tempDir()
    const pluginSkillsDir = tempDir()
    writeSkill(pluginSkillsDir, "GIT BODY", "git")

    const resolution = gitLoader(pluginSkillsDir, {
      commit_footer: false,
      include_co_authored_by: false,
      git_env_prefix: "",
    })(["git"], cwd)

    expect(resolution.prepend).toContain("GIT BODY")
    expect(resolution.prepend).not.toContain("<git_env_prefix>")
    expect(resolution.prepend).not.toContain("<commit_attribution>")
    expect(resolution.prepend).not.toMatch(CO_AUTHOR_TRAILER_PATTERN)
  })

  test("#given senpi started from a non-bash login shell #when the git skill is loaded #then the line form is the bash form senpi's bash tool runs", () => {
    const saved = { SHELL: process.env["SHELL"], PSModulePath: process.env["PSModulePath"] }
    try {
      process.env["SHELL"] = "/bin/tcsh"
      process.env["PSModulePath"] = "C:\\Program Files\\PowerShell\\Modules"
      const cwd = tempDir()
      const pluginSkillsDir = tempDir()
      writeSkill(pluginSkillsDir, "GIT BODY", "git")

      const resolution = gitLoader(pluginSkillsDir)(["git"], cwd)

      expect(resolution.prepend).toContain("GIT_MASTER=1 git")
      expect(resolution.prepend).not.toContain("setenv")
      expect(resolution.prepend).not.toContain("$env:")
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  test("#given the footer opted in #when a non-git skill is loaded #then no directive is injected", () => {
    const cwd = tempDir()
    const pluginSkillsDir = tempDir()
    writeSkill(pluginSkillsDir, "SHARED BODY")

    const loader = createTaskSkillLoader({
      agentDir: tempDir(),
      homeDir: tempDir(),
      pluginSkillsDirs: [pluginSkillsDir],
      loadSettings: () => OmoGitMasterSettingsSchema.parse({ commit_footer: true }),
    })
    const resolution = loader(["shared"], cwd)

    expect(resolution.prepend).toContain("SHARED BODY")
    expect(resolution.prepend).not.toContain("Ultraworked with")
  })
})
