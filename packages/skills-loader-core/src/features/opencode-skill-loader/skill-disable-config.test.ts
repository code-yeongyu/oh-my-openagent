import { describe, it, expect } from "bun:test"
import { collectDisabledSkillAliases, isDisabledSkillName } from "./skill-disable-config"

describe("skill-disable-config", () => {
	describe("collectDisabledSkillAliases", () => {
		it("collects bare names from disabled_skills", () => {
			const disabled = collectDisabledSkillAliases({ disabled_skills: ["frontend", "ulw-plan"] })

			expect(disabled.has("frontend")).toBe(true)
			expect(disabled.has("ulw-plan")).toBe(true)
		})

		it("normalizes names to lowercase", () => {
			const disabled = collectDisabledSkillAliases({ disabled_skills: ["Frontend"] })

			expect(disabled.has("frontend")).toBe(true)
		})

		it("keeps stale shared/ entries as-is (they no longer match plain names)", () => {
			const disabled = collectDisabledSkillAliases({ disabled_skills: ["shared/frontend"] })

			expect(disabled.has("shared/frontend")).toBe(true)
			expect(disabled.has("frontend")).toBe(false)
		})
	})

	describe("isDisabledSkillName", () => {
		it("matches a disabled bare name", () => {
			const disabled = collectDisabledSkillAliases({ disabled_skills: ["frontend"] })

			expect(isDisabledSkillName("frontend", disabled)).toBe(true)
		})

		it("does not treat shared/frontend as equivalent to frontend", () => {
			const disabled = collectDisabledSkillAliases({ disabled_skills: ["shared/frontend"] })

			expect(isDisabledSkillName("frontend", disabled)).toBe(false)
		})

		it("does not treat frontend as equivalent to shared/frontend", () => {
			const disabled = collectDisabledSkillAliases({ disabled_skills: ["frontend"] })

			expect(isDisabledSkillName("shared/frontend", disabled)).toBe(false)
		})

		it("matches an exact shared/ name when that literal name is disabled", () => {
			const disabled = collectDisabledSkillAliases({ disabled_skills: ["shared/custom"] })

			expect(isDisabledSkillName("shared/custom", disabled)).toBe(true)
		})
	})
})
