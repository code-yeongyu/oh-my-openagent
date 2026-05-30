import { describe, test, expect } from "bun:test"
import { CLI_LANGUAGES, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_MAX_MATCHES } from "./language-support"

describe("language-support", () => {
	describe("#given CLI_LANGUAGES", () => {
		describe("#when checking array structure", () => {
			test("#then is an array", () => {
				expect(Array.isArray(CLI_LANGUAGES)).toBe(true)
			})

			test("#then has exactly 25 entries", () => {
				expect(CLI_LANGUAGES.length).toBe(25)
			})

			test("#then contains only strings", () => {
				for (const lang of CLI_LANGUAGES) {
					expect(typeof lang).toBe("string")
				}
			})
		})

		describe("#when checking expected languages are present", () => {
			test("#then contains typescript", () => {
				expect(CLI_LANGUAGES).toContain("typescript")
			})

			test("#then contains python", () => {
				expect(CLI_LANGUAGES).toContain("python")
			})

			test("#then contains go", () => {
				expect(CLI_LANGUAGES).toContain("go")
			})

			test("#then contains rust", () => {
				expect(CLI_LANGUAGES).toContain("rust")
			})

			test("#then contains javascript", () => {
				expect(CLI_LANGUAGES).toContain("javascript")
			})

			test("#then contains tsx", () => {
				expect(CLI_LANGUAGES).toContain("tsx")
			})

			test("#then contains java", () => {
				expect(CLI_LANGUAGES).toContain("java")
			})

			test("#then contains cpp", () => {
				expect(CLI_LANGUAGES).toContain("cpp")
			})

			test("#then contains ruby", () => {
				expect(CLI_LANGUAGES).toContain("ruby")
			})

			test("#then contains bash", () => {
				expect(CLI_LANGUAGES).toContain("bash")
			})
		})

		describe("#when checking array has no duplicates", () => {
			test("#then all entries are unique", () => {
				const unique = new Set(CLI_LANGUAGES)
				expect(unique.size).toBe(CLI_LANGUAGES.length)
			})
		})
	})

	describe("#given DEFAULT_TIMEOUT_MS", () => {
		describe("#when checking value", () => {
			test("#then equals 300000 (5 minutes)", () => {
				expect(DEFAULT_TIMEOUT_MS).toBe(300_000)
			})

			test("#then is a number", () => {
				expect(typeof DEFAULT_TIMEOUT_MS).toBe("number")
			})
		})
	})

	describe("#given DEFAULT_MAX_OUTPUT_BYTES", () => {
		describe("#when checking value", () => {
			test("#then equals 1MB (1048576 bytes)", () => {
				expect(DEFAULT_MAX_OUTPUT_BYTES).toBe(1 * 1024 * 1024)
			})

			test("#then is a number", () => {
				expect(typeof DEFAULT_MAX_OUTPUT_BYTES).toBe("number")
			})
		})
	})

	describe("#given DEFAULT_MAX_MATCHES", () => {
		describe("#when checking value", () => {
			test("#then equals 500", () => {
				expect(DEFAULT_MAX_MATCHES).toBe(500)
			})

			test("#then is a number", () => {
				expect(typeof DEFAULT_MAX_MATCHES).toBe("number")
			})
		})
	})
})
