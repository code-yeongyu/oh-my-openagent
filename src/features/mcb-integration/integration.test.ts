import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "node:path"
import { createBuiltinSkills } from "../builtin-skills/skills"
import { McbConfigSchema } from "../../config/schema/mcb"
import { initializeMcbFromConfig } from "./config-gate"
import { getMcbAvailability, resetMcbAvailability } from "./availability"

const mcbBinaryPath = Bun.which("mcb")
const mcbAvailable = mcbBinaryPath !== null

describe("mcb-integration: skill registration", () => {
	test("oc-mcb skill is registered in builtin skills", () => {
		//#given
		const skills = createBuiltinSkills()

		//#when
		const mcbSkill = skills.find((s) => s.name === "oc-mcb")

		//#then
		expect(mcbSkill).toBeDefined()
		expect(mcbSkill!.mcpConfig).toHaveProperty("mcb")
		expect(mcbSkill!.mcpConfig!.mcb.command).toBe("mcb")
		expect(mcbSkill!.mcpConfig!.mcb.args).toEqual(["serve"])
	})

	test("oc-mcb skill can be disabled via disabledSkills", () => {
		//#given
		const skills = createBuiltinSkills({ disabledSkills: new Set(["oc-mcb"]) })

		//#when
		const mcbSkill = skills.find((s) => s.name === "oc-mcb")

		//#then
		expect(mcbSkill).toBeUndefined()
	})
})

describe("mcb-integration: config schema", () => {
	test("accepts config with new command/args fields", () => {
		//#given
		const config = {
			enabled: true,
			command: "mcb",
			args: ["serve"],
			data_dir: "/tmp/mcb-data",
		}

		//#when
		const result = McbConfigSchema.safeParse(config)

		//#then
		expect(result.success).toBe(true)
	})

	test("accepts config with env field", () => {
		//#given
		const config = {
			enabled: true,
			command: "mcb",
			args: ["serve"],
			env: { MCB_DATA_DIR: "/tmp/mcb-data" },
		}

		//#when
		const result = McbConfigSchema.safeParse(config)

		//#then
		expect(result.success).toBe(true)
	})

	test("preserves backward compatibility with url field", () => {
		//#given
		const config = {
			enabled: true,
			url: "http://localhost:3100",
		}

		//#when
		const result = McbConfigSchema.safeParse(config)

		//#then
		expect(result.success).toBe(true)
	})

	test("accepts combined url and command fields", () => {
		//#given
		const config = {
			enabled: true,
			url: "http://localhost:3100",
			command: "mcb",
			args: ["serve"],
		}

		//#when
		const result = McbConfigSchema.safeParse(config)

		//#then
		expect(result.success).toBe(true)
	})
})

describe("mcb-integration: availability with config", () => {
	test("MCB is unavailable when disabled in config", () => {
		//#given
		resetMcbAvailability()
		initializeMcbFromConfig({ enabled: false })

		//#when
		const status = getMcbAvailability()

		//#then
		expect(status.available).toBe(false)
	})

	test("MCB is available when enabled in config", () => {
		//#given
		resetMcbAvailability()
		initializeMcbFromConfig({ enabled: true })

		//#when
		const status = getMcbAvailability()

		//#then
		expect(status.available).toBe(true)
	})

	test("per-tool disabling works via config", () => {
		//#given
		resetMcbAvailability()
		initializeMcbFromConfig({ enabled: true, tools: { search: false, memory: true } })

		//#when
		const status = getMcbAvailability()

		//#then
		expect(status.tools.search).toBe(false)
		expect(status.tools.memory).toBe(true)
	})
})

describe.skipIf(!mcbAvailable)("mcb-integration: real binary", () => {
	const configPath = join(import.meta.dir, "test-mcb.toml")
	const dbPath = join(import.meta.dir, `test-integration-${Date.now()}.db`)

	beforeAll(() => {
		expect(mcbBinaryPath).not.toBeNull()
	})

	afterAll(async () => {
		const { unlink } = await import("node:fs/promises")
		await unlink(dbPath).catch(() => {})
		await unlink(`${dbPath}-shm`).catch(() => {})
		await unlink(`${dbPath}-wal`).catch(() => {})
	})

	test("mcb binary is the expected version", async () => {
		//#given
		const proc = Bun.spawn(["mcb", "--version"], { stdout: "pipe", stderr: "pipe" })

		//#when
		const output = await new Response(proc.stdout).text()
		await proc.exited

		//#then
		expect(output.trim()).toMatch(/^mcb \d+\.\d+\.\d+/)
	})

	test("mcb serve --help shows serve command info", async () => {
		//#given
		const proc = Bun.spawn(["mcb", "serve", "--help"], { stdout: "pipe", stderr: "pipe" })

		//#when
		const output = await new Response(proc.stdout).text()
		await proc.exited

		//#then
		expect(output).toContain("serve")
	})

	test("mcb serve process starts and accepts stdin with config", async () => {
		//#given - MCB 0.2.1+ requires config and DB path to stay alive
		const proc = Bun.spawn(["mcb", "serve", "--config", configPath], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, MCP__AUTH__USER_DB_PATH: dbPath },
		})

		//#when
		await new Promise((resolve) => setTimeout(resolve, 2000))
		const exited = proc.exitCode

		proc.stdin.end()
		proc.kill()
		await proc.exited

		//#then - process should still be running (exitCode null) after 2s
		expect(exited).toBeNull()
	}, 30_000)
})
