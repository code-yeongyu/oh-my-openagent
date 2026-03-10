import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { readUserConfiguredModels } from "./opencode-config-reader"

const TEST_CONFIG_DIR = join(process.cwd(), "test-opencode-config")

describe("readUserConfiguredModels", () => {
	beforeEach(() => {
		if (existsSync(TEST_CONFIG_DIR)) {
			rmSync(TEST_CONFIG_DIR, { recursive: true, force: true })
		}
		mkdirSync(TEST_CONFIG_DIR, { recursive: true })
		process.env.OPENCODE_CONFIG_DIR = TEST_CONFIG_DIR
	})

	afterEach(() => {
		delete process.env.OPENCODE_CONFIG_DIR
		if (existsSync(TEST_CONFIG_DIR)) {
			rmSync(TEST_CONFIG_DIR, { recursive: true, force: true })
		}
	})

	describe("#given opencode.json with provider models", () => {
		describe("#when readUserConfiguredModels called", () => {
			test("#then returns whitelist map", () => {
				const config = {
					provider: {
						minimax: {
							models: {
								"MiniMax-M2.5-highspeed": { name: "Highspeed" },
								"MiniMax-M2.5": { name: "Standard" },
							},
						},
						openai: {
							models: {
								"gpt-5.2": { name: "GPT-5.2" },
							},
						},
					},
				}

				writeFileSync(join(TEST_CONFIG_DIR, "opencode.json"), JSON.stringify(config, null, 2))

				const result = readUserConfiguredModels()

				expect(result).not.toBeNull()
				expect(result!.size).toBe(2)
				expect(result!.get("minimax")).toEqual(new Set(["MiniMax-M2.5-highspeed", "MiniMax-M2.5"]))
				expect(result!.get("openai")).toEqual(new Set(["gpt-5.2"]))
			})
		})
	})

	describe("#given opencode.jsonc with comments", () => {
		describe("#when readUserConfiguredModels called", () => {
			test("#then parses JSONC correctly", () => {
				const configContent = `{
					// Provider configuration
					"provider": {
						"minimax": {
							"models": {
								"MiniMax-M2.5-highspeed": { "name": "Highspeed" }
							}
						}
					}
				}`

				writeFileSync(join(TEST_CONFIG_DIR, "opencode.jsonc"), configContent)

				const result = readUserConfiguredModels()

				expect(result).not.toBeNull()
				expect(result!.size).toBe(1)
				expect(result!.get("minimax")).toEqual(new Set(["MiniMax-M2.5-highspeed"]))
			})
		})
	})

	describe("#given provider with no models", () => {
		describe("#when readUserConfiguredModels called", () => {
			test("#then excludes provider from whitelist", () => {
				const config = {
					provider: {
						minimax: {
							models: {
								"MiniMax-M2.5-highspeed": { name: "Highspeed" },
							},
						},
						openai: {
							apiKey: "sk-xxx",
						},
					},
				}

				writeFileSync(join(TEST_CONFIG_DIR, "opencode.json"), JSON.stringify(config, null, 2))

				const result = readUserConfiguredModels()

				expect(result).not.toBeNull()
				expect(result!.size).toBe(1)
				expect(result!.has("minimax")).toBe(true)
				expect(result!.has("openai")).toBe(false)
			})
		})
	})

	describe("#given no config file", () => {
		describe("#when readUserConfiguredModels called", () => {
			test("#then returns null", () => {
				const result = readUserConfiguredModels()
				expect(result).toBeNull()
			})
		})
	})

	describe("#given config with no provider section", () => {
		describe("#when readUserConfiguredModels called", () => {
			test("#then returns null", () => {
				const config = {
					plugin: ["oh-my-opencode"],
				}

				writeFileSync(join(TEST_CONFIG_DIR, "opencode.json"), JSON.stringify(config, null, 2))

				const result = readUserConfiguredModels()
				expect(result).toBeNull()
			})
		})
	})
})
