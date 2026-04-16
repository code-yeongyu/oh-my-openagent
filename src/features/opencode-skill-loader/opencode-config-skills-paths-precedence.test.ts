import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TEST_DIR = join(tmpdir(), `config-skills-paths-precedence-test-${Date.now()}`)

describe("opencode-config-skills-paths precedence", () => {
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
			return
		}

		process.env.OPENCODE_CONFIG_DIR = originalConfigDir
	})

	describe("#given both project and .opencode config define skills.paths", () => {
		describe("#when readOpenCodeSkillsPaths is called", () => {
			it("#then project config loads first and .opencode appends", async () => {
				const projectSkillsDir = join(TEST_DIR, "project-skills")
				const opencodeSkillsDir = join(TEST_DIR, "opencode-skills")
				mkdirSync(projectSkillsDir, { recursive: true })
				mkdirSync(opencodeSkillsDir, { recursive: true })

				writeFileSync(
					join(TEST_DIR, "opencode.json"),
					JSON.stringify({ skills: { paths: ["./project-skills"] } })
				)

				const opencodeDir = join(TEST_DIR, ".opencode")
				mkdirSync(opencodeDir, { recursive: true })
				writeFileSync(
					join(opencodeDir, "opencode.json"),
					JSON.stringify({ skills: { paths: ["./opencode-skills"] } })
				)

				const { readOpenCodeSkillsPaths } = await import("./opencode-config-skills-paths")
				const paths = readOpenCodeSkillsPaths(TEST_DIR)

				expect(paths).toEqual([projectSkillsDir, opencodeSkillsDir])
			})
		})
	})

	describe("#given project and global config define skills.paths", () => {
		describe("#when readOpenCodeSkillsPaths is called", () => {
			it("#then merges project and global entries", async () => {
				const projectSkillsDir = join(TEST_DIR, "project-skills")
				mkdirSync(projectSkillsDir, { recursive: true })

				writeFileSync(
					join(TEST_DIR, "opencode.json"),
					JSON.stringify({ skills: { paths: ["./project-skills"] } })
				)

				const globalDir = process.env.OPENCODE_CONFIG_DIR as string
				const globalSkillsDir = join(globalDir, "global-skills")
				mkdirSync(globalSkillsDir, { recursive: true })
				writeFileSync(
					join(globalDir, "opencode.json"),
					JSON.stringify({ skills: { paths: ["./global-skills"] } })
				)

				const { readOpenCodeSkillsPaths } = await import("./opencode-config-skills-paths")
				const paths = readOpenCodeSkillsPaths(TEST_DIR)

				expect(paths).toEqual([projectSkillsDir, globalSkillsDir])
			})
		})
	})

	describe("#given global config has relative skills.paths", () => {
		describe("#when readOpenCodeSkillsPaths is called", () => {
			it("#then resolves entries against global config directory", async () => {
				const globalDir = process.env.OPENCODE_CONFIG_DIR as string
				const globalSkillsDir = join(globalDir, "plugins", "shared-skills")
				mkdirSync(globalSkillsDir, { recursive: true })

				writeFileSync(
					join(globalDir, "opencode.json"),
					JSON.stringify({ skills: { paths: ["./plugins/shared-skills"] } })
				)

				const { readOpenCodeSkillsPaths } = await import("./opencode-config-skills-paths")
				const paths = readOpenCodeSkillsPaths(TEST_DIR)

				expect(paths).toEqual([globalSkillsDir])
			})
		})
	})
})
