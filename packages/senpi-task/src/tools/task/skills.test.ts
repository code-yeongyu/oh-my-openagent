import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { loadSkillsFromDir } from "@code-yeongyu/senpi"

import { buildSkillPrepend, createFsSkillLoader } from "./skills"

describe("buildSkillPrepend", () => {
  test("#given resolved skills #when prepended #then each SKILL.md is wrapped before the prompt", () => {
    // given
    const skills = [
      { name: "alpha", content: "ALPHA BODY" },
      { name: "beta", content: "BETA BODY" },
    ]

    // when
    const combined = buildSkillPrepend(skills, "the original prompt")

    // then
    expect(combined).toContain("ALPHA BODY")
    expect(combined).toContain("BETA BODY")
    expect(combined.indexOf("ALPHA BODY")).toBeLessThan(combined.indexOf("the original prompt"))
    expect(combined.endsWith("the original prompt")).toBe(true)
  })

  test("#given no skills #when prepended #then the prompt is returned unchanged", () => {
    // when
    const combined = buildSkillPrepend([], "just the prompt")

    // then
    expect(combined).toBe("just the prompt")
  })
})

describe("createFsSkillLoader", () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function scratch(): string {
    const root = mkdtempSync(join(tmpdir(), "senpi-task-skills-"))
    roots.push(root)
    return root
  }

  function writeSkill(root: string, name: string, body: string): string {
    const skillDir = join(root, name)
    mkdirSync(skillDir, { recursive: true })
    const skillPath = join(skillDir, "SKILL.md")
    writeFileSync(skillPath, `---\nname: ${name}\ndescription: ${name} test skill\n---\n${body}\n`, "utf8")
    return skillPath
  }

  test("#given a project skill dir #when a skill is loaded #then its SKILL.md content is resolved and prepended", () => {
    // given
    const cwd = scratch()
    const skillDir = join(cwd, ".senpi", "skills", "reviewer")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), "REVIEWER DIRECTIVE", "utf8")
    const loader = createFsSkillLoader({ homeDir: scratch() })

    // when
    const resolution = loader(["reviewer"], cwd)

    // then
    expect(resolution.resolved).toEqual(["reviewer"])
    expect(resolution.missing).toEqual([])
    expect(resolution.prepend).toContain("REVIEWER DIRECTIVE")
  })

  test("#given a missing skill #when loaded #then it is reported missing and prepend is empty", () => {
    // given
    const cwd = scratch()
    const loader = createFsSkillLoader({ homeDir: scratch() })

    // when
    const resolution = loader(["ghost"], cwd)

    // then
    expect(resolution.resolved).toEqual([])
    expect(resolution.missing).toEqual(["ghost"])
    expect(resolution.prepend).toBe("")
  })

  test("#given extra search dirs #when a skill lives there #then it resolves from the extra dir", () => {
    // given
    const cwd = scratch()
    const pluginRoot = scratch()
    const skillDir = join(pluginRoot, "packages", "shared-skills", "commit")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), "COMMIT DIRECTIVE", "utf8")
    const loader = createFsSkillLoader({
      homeDir: scratch(),
      extraDirs: [join(pluginRoot, "packages", "shared-skills")],
    })

    // when
    const resolution = loader(["commit"], cwd)

    // then
    expect(resolution.resolved).toEqual(["commit"])
    expect(resolution.prepend).toContain("COMMIT DIRECTIVE")
  })

  test("#given Senpi native project user and package locations #when multiple skills load #then every name resolves in request order", () => {
    // given
    const projectRoot = scratch()
    mkdirSync(join(projectRoot, ".git"))
    const cwd = join(projectRoot, "packages", "app")
    mkdirSync(cwd, { recursive: true })
    const homeDir = scratch()
    const agentDir = scratch()
    const packageDir = scratch()
    writeSkill(join(cwd, ".senpi", "skills"), "project-local", "PROJECT LOCAL")
    writeSkill(join(projectRoot, ".agents", "skills"), "project-agent", "PROJECT AGENT")
    writeSkill(join(cwd, ".pi", "skills"), "legacy-project", "LEGACY PROJECT")
    writeSkill(join(agentDir, "skills"), "canonical-agent", "CANONICAL AGENT")
    writeSkill(join(homeDir, ".agents", "skills"), "global-agent", "GLOBAL AGENT")
    writeSkill(packageDir, "packaged", "PACKAGED")
    const loader = createFsSkillLoader({ homeDir, agentDir, extraDirs: [packageDir] })

    // when
    const resolution = loader(
      ["packaged", "global-agent", "canonical-agent", "legacy-project", "project-agent", "project-local"],
      cwd,
    )

    // then
    expect(resolution.resolved).toEqual([
      "packaged",
      "global-agent",
      "canonical-agent",
      "legacy-project",
      "project-agent",
      "project-local",
    ])
    expect(resolution.missing).toEqual([])
    expect(resolution.prepend.indexOf("PACKAGED")).toBeLessThan(resolution.prepend.indexOf("GLOBAL AGENT"))
    expect(resolution.prepend.indexOf("GLOBAL AGENT")).toBeLessThan(resolution.prepend.indexOf("PROJECT LOCAL"))
  })

  test("#given a direct markdown skill with frontmatter #when loaded #then only its body and source location are injected", () => {
    // given
    const cwd = scratch()
    const skillsDir = join(cwd, ".senpi", "skills")
    mkdirSync(skillsDir, { recursive: true })
    const skillPath = join(skillsDir, "direct.md")
    writeFileSync(
      skillPath,
      "---\nname: direct\ndescription: Direct root skill\n---\nDIRECT BODY\n",
      "utf8",
    )
    const loader = createFsSkillLoader({ homeDir: scratch() })

    // when
    const resolution = loader(["direct"], cwd)

    // then
    expect(resolution.resolved).toEqual(["direct"])
    expect(resolution.prepend).toContain(`<skill name="direct" location="${skillPath}">`)
    expect(resolution.prepend).toContain(`References are relative to ${skillsDir}.`)
    expect(resolution.prepend).toContain("DIRECT BODY")
    expect(resolution.prepend).not.toContain("description: Direct root skill")
  })

  test("#given several indirect skill names #when loaded together #then every existing directory is discovered once", () => {
    // given
    const projectRoot = scratch()
    mkdirSync(join(projectRoot, ".git"))
    const cwd = join(projectRoot, "app")
    mkdirSync(cwd)
    const projectSkills = join(cwd, ".senpi", "skills")
    const homeDir = scratch()
    const globalSkills = join(homeDir, ".agents", "skills")
    const agentDir = scratch()
    const agentSkills = join(agentDir, "skills")
    const packageSkills = scratch()
    const aliasedDir = join(packageSkills, "nested")
    for (const dir of [projectSkills, globalSkills, agentSkills, aliasedDir]) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(
      join(aliasedDir, "SKILL.md"),
      "---\nname: aliased\ndescription: Aliased nested skill\n---\nALIASED BODY\n",
      "utf8",
    )
    const scans: string[] = []
    const loader = createFsSkillLoader({
      homeDir,
      agentDir,
      extraDirs: [packageSkills],
      loadSkillsFromDir: (options) => {
        scans.push(options.dir)
        return loadSkillsFromDir(options)
      },
    })

    // when
    const resolution = loader(["missing-one", "aliased", "missing-two"], cwd)

    // then
    expect(resolution.resolved).toEqual(["aliased"])
    expect(resolution.missing).toEqual(["missing-one", "missing-two"])
    expect(scans).toEqual([projectSkills, agentSkills, globalSkills, packageSkills])
  })
})
