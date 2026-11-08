import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..")

// Issue #6128: GPT-5.6 made the ulw-plan high-accuracy review non-convergent because the
// shared (OpenCode) and Codex editions shipped an unbounded "fix every cited issue and
// resubmit until approval" protocol with no round cap and no blocker-eligibility rule.
// This contract is machine-consumed review policy: every edition's full-workflow.md must
// carry the same bounded convergence contract JSON. #8773 added the ideal-state category: an
// IS row no todo closes or no QA scenario proves, or an approach that cannot reach it for the
// named user, is blocker-eligible in every edition. #10378 replaced the fixed 5-round cap, which stopped
// reviews that were still making progress: another round runs while the previous one raised a new
// blocker-eligible finding or closed at least one ledger blocker, and a round with neither stops the review
// (the non-convergence guard; it terminates because the ledger is frozen after round 1).
const surfaces = [
	{
		name: "shared (OpenCode Ultimate)",
		workflowPath: join(repoRoot, "packages", "shared-skills", "skills", "ulw-plan", "references", "full-workflow.md"),
	},
	{
		name: "omo-senpi",
		workflowPath: join(repoRoot, "packages", "omo-senpi", "skills", "ulw-plan", "references", "full-workflow.md"),
	},
	{
		name: "Codex component",
		workflowPath: join(
			repoRoot,
			"packages",
			"omo-codex",
			"plugin",
			"components",
			"ultrawork",
			"skills",
			"ulw-plan",
			"references",
			"full-workflow.md",
		),
	},
] as const

const BLOCKER_ELIGIBILITY = [
	"explicit_requirement_or_accepted_decision",
	"existing_failing_regression",
	"reproducible_broken_flow",
	"concrete_security_data_loss_or_compatibility_risk",
	"external_api_provider_or_release_contract_conflict",
	"ideal_state_row_unmapped_or_unreachable_for_the_affected_user",
] as const

function readJsonContract(workflow: string, contractName: string): Record<string, unknown> {
	const fence = "```"
	const pattern = new RegExp(`<!-- ${contractName} -->\\s*${fence}json\\s*([\\s\\S]*?)\\s*${fence}`)
	const match = workflow.match(pattern)
	if (!match?.[1]) throw new Error(`missing ${contractName}`)
	return JSON.parse(match[1]) as Record<string, unknown>
}

describe("#given the ulw-plan high-accuracy review protocol across all three editions", () => {
	for (const surface of surfaces) {
		describe(`#when the ${surface.name} full-workflow.md declares its review convergence contract`, () => {
			const workflow = readFileSync(surface.workflowPath, "utf8")

			test("#then rounds continue on new eligible findings or closed ledger blockers and stop with a user-facing action otherwise", () => {
				const contract = readJsonContract(workflow, "ulw-plan-review-convergence-contract")
				expect(contract.max_rounds).toBeNull()
				expect(contract.continue_while).toBe(
					"previous_round_raised_new_blocker_eligible_finding_or_closed_ledger_blocker",
				)
				expect(contract.stop_on).toBe("round_without_new_blocker_eligible_finding_or_ledger_blocker_closure")
				expect(contract.on_stop_without_approval).toBe("stop_report_outstanding_blockers_ask_user")
				expect(contract).not.toHaveProperty("max_rounds_override")
			})

			test("#then only evidence-backed findings are blocker-eligible and the rest are non-blocking notes", () => {
				const contract = readJsonContract(workflow, "ulw-plan-review-convergence-contract")
				expect(contract.blocker_eligibility).toEqual([...BLOCKER_ELIGIBILITY])
				expect(contract.ineligible_finding_disposition).toBe("non_blocking_note")
				expect(contract.approval_with_notes_counts_as_approval).toBe(true)
			})

			test("#then the blocker ledger freezes after the discovery round and fixes stay minimal", () => {
				const contract = readJsonContract(workflow, "ulw-plan-review-convergence-contract")
				expect(contract.ledger_freeze_after_round).toBe(1)
				expect(contract.closure_round_scope).toEqual([
					"accepted_ledger_blockers",
					"regressions_introduced_by_fixes",
					"new_findings_passing_blocker_eligibility",
				])
				expect(contract.fix_edit_policy).toBe("smallest_edit_no_scope_expansion")
			})
		})
	}
})
