import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OhMyOpenCodeConfigSchema } from "../../config"
import { validatePluginConfig } from "../../config/validate"
import { createSkillContext } from "../../plugin/skill-context"
import { createSkillTool } from "./tools"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "native-skill-containment-"))
  roots.push(root)
  const project = join(root, "project")
  const outside = join(root, "outside")
  mkdirSync(join(project, ".opencode"), { recursive: true })
  mkdirSync(join(project, ".git"))
  mkdirSync(outside)
  writeFileSync(join(outside, "SKILL.md"), "---\nname: escape\ndescription: synthetic\n---\nOUTSIDE FIXTURE\n")
  return { root, project, outside }
}

test.each(["root", "nested"])("merged host discovery checks the spelled project %s before dereference", async (layout) => {
  // given
  const f = fixture()
  const skillsRoot = join(f.project, ".opencode", "skills")
  if (layout === "root") symlinkSync(f.outside, skillsRoot)
  else {
    mkdirSync(skillsRoot)
    symlinkSync(f.outside, join(skillsRoot, "escape"))
  }
  const diagnostics: { category: string }[] = []
  // when
  const result = await createSkillContext(Object.assign({
    directory: f.project,
    pluginConfig: OhMyOpenCodeConfigSchema.parse({ claude_code: { skills: false } }),
    hostSkills: { paths: [skillsRoot] },
  }, { onDiagnostic: (d: { category: string }) => diagnostics.push(d) }))
  // then
  expect(result.mergedSkills.some((s) => s.name === "escape")).toBe(false)
  expect(diagnostics.some((d) => d.category === "skill-link-blocked")).toBe(true)
})

test.each(["root", "nested"])("native fallback cannot restore escaping project %s cached bytes", async (layout) => {
  // given
  const f = fixture()
  const skillsRoot = join(f.project, ".opencode", "skills")
  if (layout === "root") symlinkSync(f.outside, skillsRoot)
  else {
    mkdirSync(skillsRoot)
    symlinkSync(f.outside, join(skillsRoot, "escape"))
  }
  const location = layout === "root" ? join(skillsRoot, "SKILL.md") : join(skillsRoot, "escape", "SKILL.md")
  const entry = { name: "escape", description: "fixture", location, content: "PRE-READ OUTSIDE FIXTURE" }
  const tool = createSkillTool({
    directory: f.project, skills: [], commands: [],
    nativeSkills: { all: () => [entry], get: () => entry, dirs: () => [skillsRoot] },
  })
  // when / then
  await expect(tool.execute({ name: "escape" }, undefined)).rejects.toThrow("outside the project")
})

test("native fallback cannot restore a missing project descendant's cached bytes", async () => {
  // given - unresolved descendants still retain project authority through root aliases (#10693).
  const f = fixture()
  const entry = {
    name: "missing", description: "fixture",
    location: join(f.project, ".opencode", "skills", "missing", "SKILL.md"),
    content: "PRE-READ MISSING FIXTURE",
  }
  const tool = createSkillTool({
    directory: f.project, skills: [], commands: [],
    nativeSkills: { all: () => [entry], get: () => entry, dirs: () => [] },
  })
  // when / then
  await expect(tool.execute({ name: "missing" }, undefined)).rejects.toThrow("ENOENT")
})

test("native builtin row keeps its supplied descriptorless content", async () => {
  // given
  const f = fixture()
  const entry = { name: "builtin-fixture", description: "fixture", location: "<built-in>", content: "BUILTIN FIXTURE" }
  const tool = createSkillTool({
    directory: f.project, skills: [], commands: [],
    nativeSkills: { all: () => [entry], get: () => entry, dirs: () => [] },
  })
  // when
  const result = await tool.execute({ name: "builtin-fixture" }, undefined)
  // then
  expect(result).toContain("BUILTIN FIXTURE")
})

test.each(["project", "user"])("omo config retains %s origin for an outside skills.sources root", async (origin) => {
  // given
  const f = fixture()
  const home = join(f.root, "home")
  mkdirSync(home)
  const configRoot = join(origin === "user" ? home : f.project, ".omo")
  mkdirSync(configRoot)
  writeFileSync(join(configRoot, "omo.jsonc"), JSON.stringify({
    "[opencode]": { claude_code: { skills: false }, skills: { sources: [f.outside] } },
  }))
  const pluginConfig = validatePluginConfig(f.project, { HOME: home }).config
  // when
  const result = await createSkillContext({ directory: f.project, pluginConfig, hostSkills: {} })
  // then
  expect(result.mergedSkills.some((s) => s.name === "escape")).toBe(origin === "user")
})
