import { describe, expect, mock, test } from "bun:test"
import type { ToonCompressionConfig } from "../../shared/toon-compression"

// Mock @toon-format/toon at module level
mock.module("@toon-format/toon", () => ({
	encode: mock((data: unknown) => {
		// Simple mock that returns a TOON-like format for arrays
		if (Array.isArray(data) && data.length > 0) {
			const keys = Object.keys(data[0]).sort()
			return `[${data.length}]{${keys.join(",")}}:${JSON.stringify(data)}`
		}
		return JSON.stringify(data)
	}),
}))

// Import after mock is set up
import {
	compressSkillContent,
	compressSkillInjection,
	compressSkillTemplates,
} from "./skill-content-resolver"

const ENABLED_CONFIG: ToonCompressionConfig = {
	enabled: true,
	threshold: 100,
}

const DISABLED_CONFIG: ToonCompressionConfig = {
	enabled: false,
	threshold: 100,
}

describe("skill-content-resolver", () => {
	describe("#given compressSkillContent", () => {
		describe("#when compression is disabled", () => {
			test("#then returns original string content", () => {
				const content = "This is skill content"
				const result = compressSkillContent(content, DISABLED_CONFIG)
				// safeCompress returns raw string for string input (not JSON.stringify'd)
				expect(result).toBe(content)
			})
		})

		describe("#when compression is enabled", () => {
			test("#then returns original string (strings not compressed)", () => {
				const content = "A".repeat(200)
				const result = compressSkillContent(content, ENABLED_CONFIG)
				// String content is returned as-is (compression only works on uniform arrays)
				expect(result).toBe(content)
			})

			test("#then uses default config when not provided", () => {
				const content = "Simple content"
				const result = compressSkillContent(content)
				expect(typeof result).toBe("string")
			})
		})
	})

	describe("#given compressSkillTemplates", () => {
		describe("#when given empty map", () => {
			test("#then returns empty array JSON", () => {
				const skills = new Map<string, string>()
				const result = compressSkillTemplates(skills, ENABLED_CONFIG)
				expect(result).toBe("[]")
			})
		})

		describe("#when given map with single skill", () => {
			test("#then returns array with one item", () => {
				const skills = new Map([["git-master", "Git skill template"]])
				const result = compressSkillTemplates(skills, ENABLED_CONFIG)
				expect(result).toContain("git-master")
				expect(result).toContain("Git skill template")
			})
		})

		describe("#when given map with multiple skills", () => {
			test("#then compresses array of skill objects", () => {
				const skills = new Map([
					["skill-a", "Template A content"],
					["skill-b", "Template B content"],
					["skill-c", "Template C content"],
					["skill-d", "Template D content"],
					["skill-e", "Template E content"],
					["skill-f", "Template F content"],
				])
				const result = compressSkillTemplates(skills, ENABLED_CONFIG)
				// Should contain TOON-like format for uniform array
				expect(result).toContain("[6]")
			})

			test("#then returns compact JSON when compression disabled", () => {
				const skills = new Map([
					["skill-a", "Template A"],
					["skill-b", "Template B"],
				])
				const result = compressSkillTemplates(skills, DISABLED_CONFIG)
				expect(result).toContain("skill-a")
				expect(result).toContain("skill-b")
			})
		})
	})

	describe("#given compressSkillInjection", () => {
		describe("#when given skill name and template only", () => {
			test("#then returns structured injection data", () => {
				const result = compressSkillInjection("playwright", "Browser automation skill", undefined, ENABLED_CONFIG)
				expect(result).toContain("playwright")
				expect(result).toContain("Browser automation skill")
				expect(result).toContain("skill")
				expect(result).toContain("content")
			})
		})

		describe("#when given metadata", () => {
			test("#then includes metadata in output", () => {
				const metadata = { source: "/path/to/skill", scope: "project" }
				const result = compressSkillInjection(
					"git-master",
					"Git skill",
					metadata,
					ENABLED_CONFIG
				)
				expect(result).toContain("meta")
				expect(result).toContain("/path/to/skill")
				expect(result).toContain("project")
			})
		})

		describe("#when compression is disabled", () => {
			test("#then returns JSON object without TOON compression", () => {
				const result = compressSkillInjection(
					"test-skill",
					"Test template",
					undefined,
					DISABLED_CONFIG
				)
				expect(result).toContain("test-skill")
				expect(result).toContain("Test template")
			})
		})

		describe("#when using default config", () => {
			test("#then uses disabled compression by default", () => {
				const result = compressSkillInjection("skill", "template")
				expect(typeof result).toBe("string")
				expect(result).toContain("skill")
			})
		})
	})
})
