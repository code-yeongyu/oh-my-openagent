import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { setGlobalCompressionConfig, resetGlobalCompressionConfig } from "../../shared/toon-compression/config-store"

mock.module("@toon-format/toon", () => ({
	encode: mock((data: unknown) => {
		if (Array.isArray(data) && data.length > 0) {
			const keys = Object.keys(data[0]).sort()
			return `[${data.length}]{${keys.join(",")}}:${JSON.stringify(data)}`
		}
		return JSON.stringify(data)
	}),
}))

import {
	compressSkillContent,
	compressSkillInjection,
	compressSkillTemplates,
} from "./skill-content-resolver"

describe("skill-content-resolver", () => {
	beforeEach(() => {
		setGlobalCompressionConfig({ enabled: true, threshold: 100 })
	})

	afterEach(() => {
		resetGlobalCompressionConfig()
	})

	describe("#given compressSkillContent", () => {
		describe("#when given string content", () => {
			test("#then returns original string content", () => {
				const content = "This is skill content"
				const result = compressSkillContent(content)
				expect(result).toBe(content)
			})
		})

		describe("#when given long string content", () => {
			test("#then returns original string (strings not compressed)", () => {
				const content = "A".repeat(200)
				const result = compressSkillContent(content)
				expect(result).toBe(content)
			})
		})
	})

	describe("#given compressSkillTemplates", () => {
		describe("#when given empty map", () => {
			test("#then returns empty array JSON", () => {
				const skills = new Map<string, string>()
				const result = compressSkillTemplates(skills)
				expect(result).toBe("[]")
			})
		})

		describe("#when given map with single skill", () => {
			test("#then returns array with one item", () => {
				const skills = new Map([["git-master", "Git skill template"]])
				const result = compressSkillTemplates(skills)
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
				const result = compressSkillTemplates(skills)
				expect(result).toContain("[6]")
			})
		})
	})

	describe("#given compressSkillInjection", () => {
		describe("#when given skill name and template only", () => {
			test("#then returns structured injection data", () => {
				const result = compressSkillInjection("playwright", "Browser automation skill")
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
					metadata
				)
				expect(result).toContain("meta")
				expect(result).toContain("/path/to/skill")
				expect(result).toContain("project")
			})
		})

		describe("#when using default config", () => {
			test("#then returns JSON object", () => {
				const result = compressSkillInjection("skill", "template")
				expect(typeof result).toBe("string")
				expect(result).toContain("skill")
			})
		})
	})
})
