import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { OmoGitMasterSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createTaskSkillLoader, packagedSkillDirs } from "./task-skill-loader"

const CO_AUTHOR_TRAILER_PATTERN = /Co-authored-by:/i

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

  test("#given default attribution settings #when the git-master skill is loaded #then the env-prefix section rides the skill block and no footer is added", () => {
    const cwd = tempDir()
    const pluginSkillsDir = tempDir()
    writeSkill(
      pluginSkillsDir,
      "GIT MASTER BODY\n\n```bash\ngit add -A .\ngit commit -m \"x\"\n```",
      "git-master",
    )

    const loader = createTaskSkillLoader({
      agentDir: tempDir(),
      homeDir: tempDir(),
      pluginSkillsDirs: [pluginSkillsDir],
      loadSettings: () => OmoGitMasterSettingsSchema.parse({}),
    })
    const resolution = loader(["git-master"], cwd)

    expect(resolution.resolved).toEqual(["git-master"])
    expect(resolution.prepend).toContain("GIT MASTER BODY")
    expect(resolution.prepend).toContain("GIT COMMAND PREFIX (MANDATORY)")
    expect(resolution.prepend).toContain("GIT_MASTER=1 git add -A .")
    expect(resolution.prepend).toContain('GIT_MASTER=1 git commit -m "x"')
    expect(resolution.prepend).not.toMatch(CO_AUTHOR_TRAILER_PATTERN)
    expect(resolution.prepend).not.toContain("sisyphus-dev-ai")
    expect(resolution.prepend).not.toContain("Ultraworked with")
  })

  test("#given the footer opted in #when the git-master skill is loaded #then only the footer directive rides the skill block", () => {
    const cwd = tempDir()
    const pluginSkillsDir = tempDir()
    writeSkill(pluginSkillsDir, "GIT MASTER BODY", "git-master")

    const loader = createTaskSkillLoader({
      agentDir: tempDir(),
      homeDir: tempDir(),
      pluginSkillsDirs: [pluginSkillsDir],
      loadSettings: () => OmoGitMasterSettingsSchema.parse({ commit_footer: true, include_co_authored_by: true }),
    })
    const resolution = loader(["git-master"], cwd)

    expect(resolution.prepend).toContain("GIT MASTER BODY")
    expect(resolution.prepend).toContain("Ultraworked with")
    expect(resolution.prepend).toContain("GIT COMMAND PREFIX (MANDATORY)")
    expect(resolution.prepend).not.toMatch(CO_AUTHOR_TRAILER_PATTERN)
    expect(resolution.prepend).not.toContain("users.noreply.github.com")
  })

  test("#given attribution disabled and the env prefix disabled #when the git-master skill is loaded #then the skill block stays untouched", () => {
    const cwd = tempDir()
    const pluginSkillsDir = tempDir()
    writeSkill(pluginSkillsDir, "GIT MASTER BODY", "git-master")

    const loader = createTaskSkillLoader({
      agentDir: tempDir(),
      homeDir: tempDir(),
      pluginSkillsDirs: [pluginSkillsDir],
      loadSettings: () =>
        OmoGitMasterSettingsSchema.parse({ commit_footer: false, include_co_authored_by: false, git_env_prefix: "" }),
    })
    const resolution = loader(["git-master"], cwd)

    expect(resolution.prepend).toContain("GIT MASTER BODY")
    expect(resolution.prepend).not.toContain("GIT COMMAND PREFIX (MANDATORY)")
    expect(resolution.prepend).not.toMatch(CO_AUTHOR_TRAILER_PATTERN)
    expect(resolution.prepend).not.toContain("Ultraworked with")
  })

  test("#given senpi started from a non-bash login shell #when the git-master skill is loaded #then the prefix uses the bash form senpi's bash tool runs", () => {
    const saved = { SHELL: process.env["SHELL"], PSModulePath: process.env["PSModulePath"] }
    try {
      process.env["SHELL"] = "/bin/tcsh"
      process.env["PSModulePath"] = "C:\\Program Files\\PowerShell\\Modules"
      const cwd = tempDir()
      const pluginSkillsDir = tempDir()
      writeSkill(pluginSkillsDir, "GIT MASTER BODY\n\n```bash\ngit status\n```", "git-master")

      const loader = createTaskSkillLoader({
        agentDir: tempDir(),
        homeDir: tempDir(),
        pluginSkillsDirs: [pluginSkillsDir],
        loadSettings: () => OmoGitMasterSettingsSchema.parse({}),
      })
      const resolution = loader(["git-master"], cwd)

      expect(resolution.prepend).toContain("\nGIT_MASTER=1 git status\n```")
      expect(resolution.prepend).not.toContain("setenv")
      expect(resolution.prepend).not.toContain("$env:")
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  test("#given the footer opted in #when a non-git-master skill is loaded #then no directive is injected", () => {
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
