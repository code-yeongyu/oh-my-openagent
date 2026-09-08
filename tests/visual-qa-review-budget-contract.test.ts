import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..")

// Issue #6755: the visual-qa completion gate required "loop until the independent reviewer
// passes on the current build" with no round ceiling, so every fresh reviewer could report a
// different valid defect and the review chain never terminated. This contract is
// machine-consumed review policy: the skill must carry an explicit review budget whose
// exhaustion surfaces needs-human-review instead of another reviewer dispatch.
const skillPath = join(repoRoot, "packages", "shared-skills", "skills", "visual-qa", "SKILL.md")

function readJsonContract(skill: string, contractName: string): Record<string, unknown> {
	const fence = "```"
	const pattern = new RegExp(`<!-- ${contractName} -->\\s*${fence}json\\s*([\\s\\S]*?)\\s*${fence}`)
	const match = skill.match(pattern)
	if (!match?.[1]) throw new Error(`missing ${contractName}`)
	return JSON.parse(match[1]) as Record<string, unknown>
}

describe("#given the visual-qa fresh-review completion loop", () => {
	describe("#when SKILL.md declares its review budget contract", () => {
		const skill = readFileSync(skillPath, "utf8")
		let contract: Record<string, unknown>
		try {
			contract = readJsonContract(skill, "visual-qa-review-budget-contract")
		} catch (error) {
			contract = {}
			test("#then the machine-consumed budget sentinel exists", () => {
				throw error
			})
		}

		test("#then the maximum review count is finite per surface risk", () => {
			const maxReviewRounds = contract.max_review_rounds as Record<string, unknown>
			expect(Number.isInteger(maxReviewRounds.low_risk_surface)).toBe(true)
			expect(maxReviewRounds.low_risk_surface as number).toBe(1)
			expect(Number.isInteger(maxReviewRounds.normal_product_surface)).toBe(true)
			expect(maxReviewRounds.normal_product_surface as number).toBeGreaterThanOrEqual(2)
			expect(maxReviewRounds.normal_product_surface as number).toBeLessThanOrEqual(3)
			expect(contract.budget_override).toBe("explicit_user_request_only")
		})

		test("#then non-blocking findings never schedule a new reviewer", () => {
			expect(contract.non_blocking_finding_disposition).toBe("note_no_new_reviewer")
		})

		test("#then a blocker fixed inside the budget earns a focused fresh review", () => {
			expect(contract.blocker_fix_re_review).toBe("focused_fresh_reviewer_within_budget")
		})

		test("#then exhausting the budget returns needs-human-review instead of dispatching again", () => {
			expect(contract.on_budget_exhausted).toBe("needs-human-review")
		})
	})
})
