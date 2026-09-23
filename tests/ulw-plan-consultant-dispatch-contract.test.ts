import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..")

// Issue #8509: This contract is declarative policy, the same class as the #6128 review
// convergence contract. Every edition's full-workflow.md must carry the same consultant
// dispatch contract JSON so the complete-draft ordering remains machine-checked.
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

function readJsonContract(workflow: string, contractName: string): Record<string, unknown> {
	const fence = "```"
	const pattern = new RegExp(`<!-- ${contractName} -->\\s*${fence}json\\s*([\\s\\S]*?)\\s*${fence}`)
	const match = workflow.match(pattern)
	if (!match?.[1]) throw new Error(`missing ${contractName}`)
	return JSON.parse(match[1]) as Record<string, unknown>
}

describe("#given the ulw-plan consultant dispatch protocol across all three editions", () => {
	for (const surface of surfaces) {
		describe(`#when the ${surface.name} full-workflow.md declares its consultant dispatch contract`, () => {
			const workflow = readFileSync(surface.workflowPath, "utf8")

			test("#then it requires the complete draft before one consultant pass and folds findings before review", () => {
				const contract = readJsonContract(workflow, "ulw-plan-consultant-dispatch-contract")
				expect(contract.consultant_passes).toBe(1)
				expect(contract.dispatch_after).toEqual([
					"plan_skeleton_scaffolded",
					"todos_appended",
					"tldr_filled",
					"structural_self_check_passed",
				])
				expect(contract.consultant_input).toBe("exact_plan_path")
				expect(contract.unreadable_plan).toBe("stop_and_redispatch")
				expect(contract.fold_findings_before).toBe("high_accuracy_review")
				expect(contract.structural_self_check_after_fold).toBe("rerun_if_plan_changed")
				expect(contract.unsafe_owner_decision).toBe("return_to_approval_gate")
				expect(contract.review_after_fold).toBe("phase_4_policy")
				expect(contract.bootstrap_exception).toBe("edition_specific_unchanged")
			})
		})
	}
})

describe("#given the consultant dispatch contracts across all three editions", () => {
	test("#when their JSON contracts are parsed #then they are identical", () => {
		const contracts = surfaces.map((surface) => {
			const workflow = readFileSync(surface.workflowPath, "utf8")
			return readJsonContract(workflow, "ulw-plan-consultant-dispatch-contract")
		})
		expect(contracts[1]).toEqual(contracts[0])
		expect(contracts[2]).toEqual(contracts[0])
	})
})
