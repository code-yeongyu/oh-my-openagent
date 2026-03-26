import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const TEST_DIR = join(tmpdir(), "config-skills-paths-test-" + Date.now())

describe("opencode-config-skills-paths", () => {
	let originalConfigDir: string | undefined

	beforeEach(() => {
		mkdirSync(TEST_DIR, { recursive: true })
		originalConfigDir = process.env.OPENCODE_CONFIG_DIR
		process.env.OPENCODE_CONFIG_DIR = join(TEST_DIR, ".global-config")
	})

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true })
		if (originalConfigDir === undefined) {
			delete process.env.OPENCODE_CONFIG_DIR
		} else {
			process.env.OPENCODE_CONFIG_DIR = originalConfigDir
		}
	})

	describe("#given opencode.json with skills.paths", () => {
		describe("#when readOpenCodeSkillsPaths is called", () => {
			it("#then returns resolved absolute paths", async () => {
				const pluginSkillsDir = join(TEST_DIR, "my-plugin", "skills")
				mkdirSync(pluginSkillsDir, { recursive: true })

				const opencodeDir = join(TEST_DIR, ".opencode")
				mkdirSync(opencodeDir, { recursive: true })
				writeFileSync(
					join(opencodeDir, "opencode.json"),
					JSON.stringify({ skills: { paths: [pluginSkillsDir] } })
				)

				const { readOpenCodeSkillsPaths } = await import("./opencode-config-skills-paths")
				const paths = readOpenCodeSkillsPaths(TEST_DIR)

				expect(paths).toEqual([pluginSkillsDir])
			})
		})
	})

	describe("#given opencode.json with relative skills.paths", () => {
		describe("#when readOpenCodeSkillsPaths is called", () => {
			it("#then resolves relative paths against directory", async () => {
				const pluginSkillsDir = join(TEST_DIR, "plugins", "my-plugin", "skills")
				mkdirSync(pluginSkillsDir, { recursive: true })

				const opencodeDir = join(TEST_DIR, ".opencode")
				mkdirSync(opencodeDir, { recursive: true })
				writeFileSync(
					join(opencodeDir, "opencode.json"),
					JSON.stringify({ skills: { paths: ["plugins/my-plugin/skills"] } })
				)

				const { readOpenCodeSkillsPaths } = await import("./opencode-config-skills-paths")
				const paths = readOpenCodeSkillsPaths(TEST_DIR)

				expect(paths).toEqual([pluginSkillsDir])
			})
		})
	})

	describe("#given opencode.json with non-existent skills.paths entry", () => {
		describe("#when readOpenCodeSkillsPaths is called", () => {
			it("#then filters out non-existent paths", async () => {
				const opencodeDir = join(TEST_DIR, ".opencode")
				mkdirSync(opencodeDir, { recursive: true })
				writeFileSync(
					join(opencodeDir, "opencode.json"),
					JSON.stringify({ skills: { paths: ["/does/not/exist"] } })
				)

				const { readOpenCodeSkillsPaths } = await import("./opencode-config-skills-paths")
				const paths = readOpenCodeSkillsPaths(TEST_DIR)

				expect(paths).toEqual([])
			})
		})
	})

	describe("#given no opencode.json", () => {
		describe("#when readOpenCodeSkillsPaths is called", () => {
			it("#then returns empty array", async () => {
				const { readOpenCodeSkillsPaths } = await import("./opencode-config-skills-paths")
				const paths = readOpenCodeSkillsPaths(TEST_DIR)

				expect(paths).toEqual([])
			})
		})
	})

	describe("#given opencode.jsonc with skills.paths", () => {
		describe("#when readOpenCodeSkillsPaths is called", () => {
			it("#then parses JSONC format correctly", async () => {
				const pluginSkillsDir = join(TEST_DIR, "my-plugin", "skills")
				mkdirSync(pluginSkillsDir, { recursive: true })

				const opencodeDir = join(TEST_DIR, ".opencode")
				mkdirSync(opencodeDir, { recursive: true })
				const jsoncContent = [
					"{",
					"  // Plugin skill paths",
					"  \"skills\": {",
					`    "paths": [${JSON.stringify(pluginSkillsDir)}]`,
					"  }",
					"}",
				].join("\n")
				writeFileSync(join(opencodeDir, "opencode.jsonc"), jsoncContent)

				const { readOpenCodeSkillsPaths } = await import("./opencode-config-skills-paths")
				const paths = readOpenCodeSkillsPaths(TEST_DIR)

				expect(paths).toEqual([pluginSkillsDir])
			})
		})
	})

	describe("#given opencode.json with skills.paths pointing to skill directories", () => {
		describe("#when discoverConfigPathsSkills is called", () => {
			it("#then discovers SKILL.md files from configured paths", async () => {
				const pluginSkillsDir = join(TEST_DIR, "my-plugin", "skills")
				const skillDir = join(pluginSkillsDir, "my-skill")
				mkdirSync(skillDir, { recursive: true })
				writeFileSync(
					join(skillDir, "SKILL.md"),
					`---
name: my-plugin-skill
description: A skill from plugin
---
Plugin skill content.
`
				)

				const opencodeDir = join(TEST_DIR, ".opencode")
				mkdirSync(opencodeDir, { recursive: true })
				writeFileSync(
					join(opencodeDir, "opencode.json"),
					JSON.stringify({ skills: { paths: [pluginSkillsDir] } })
				)

				const { discoverConfigPathsSkills } = await import("./loader")
				const skills = await discoverConfigPathsSkills(TEST_DIR)
				const skill = skills.find(s => s.name === "my-plugin-skill")

				expect(skill).toBeDefined()
				expect(skill?.scope).toBe("config")
				expect(skill?.definition.description).toContain("A skill from plugin")
			})
		})
	})

	describe("#given opencode.json with multiple skills.paths", () => {
		describe("#when discoverConfigPathsSkills is called", () => {
			it("#then discovers skills from all configured paths", async () => {
				const plugin1Dir = join(TEST_DIR, "plugin-1", "skills")
				const skill1Dir = join(plugin1Dir, "skill-a")
				mkdirSync(skill1Dir, { recursive: true })
				writeFileSync(
					join(skill1Dir, "SKILL.md"),
					`---
name: skill-a
description: Skill A
---
Content A.
`
				)

				const plugin2Dir = join(TEST_DIR, "plugin-2", "skills")
				const skill2Dir = join(plugin2Dir, "skill-b")
				mkdirSync(skill2Dir, { recursive: true })
				writeFileSync(
					join(skill2Dir, "SKILL.md"),
					`---
name: skill-b
description: Skill B
---
Content B.
`
				)

				const opencodeDir = join(TEST_DIR, ".opencode")
				mkdirSync(opencodeDir, { recursive: true })
				writeFileSync(
					join(opencodeDir, "opencode.json"),
					JSON.stringify({ skills: { paths: [plugin1Dir, plugin2Dir] } })
				)

				const { discoverConfigPathsSkills } = await import("./loader")
				const skills = await discoverConfigPathsSkills(TEST_DIR)

				expect(skills.find(s => s.name === "skill-a")).toBeDefined()
				expect(skills.find(s => s.name === "skill-b")).toBeDefined()
				expect(skills.length).toBe(2)
			})
		})
	})
})
