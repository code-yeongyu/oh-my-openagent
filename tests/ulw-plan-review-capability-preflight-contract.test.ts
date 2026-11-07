import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..")

// #10137: the high-accuracy review's first action needs a descriptor-relative no-follow open plus a
// digest of bytes read from that same descriptor. A host whose read-only policy cannot provide that
// chain gets INCONCLUSIVE on every round, and INCONCLUSIVE starts a fresh round, so the review loops.
// The interim contract (decision pending) is a capability preflight that runs once before round 1
// and ends the review with one capability blocker instead of dispatching rounds. These are the
// machine-consumed contract values every edition must carry; the tests are RED until it ships.
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

describe("#given a host whose read-only policy cannot open the plan through a descriptor chain (#10137)", () => {
	for (const surface of surfaces) {
		const workflow = readFileSync(surface.workflowPath, "utf8")

		test(`#then ${surface.name} runs a capability preflight once, before round 1`, () => {
			const intake = readJsonContract(workflow, "ulw-plan-review-intake-contract")
			const preflight = intake.capability_preflight as Record<string, unknown> | undefined
			expect(preflight?.runs).toBe("once_before_round_1")
			expect(preflight?.probes).toBe("read_mechanism")
		})

		test(`#then ${surface.name} ends the review with one capability blocker instead of an inconclusive round`, () => {
			const intake = readJsonContract(workflow, "ulw-plan-review-intake-contract")
			const preflight = intake.capability_preflight as Record<string, unknown> | undefined
			expect(preflight?.on_unavailable).toBe("CAPABILITY_BLOCKED")
			expect(preflight?.rounds_dispatched_after_block).toBe(0)
		})

		test(`#then ${surface.name} never restarts a round after a capability block, even after compaction`, () => {
			const lifecycle = readJsonContract(workflow, "ulw-plan-review-lifecycle-state-contract")
			const resume = lifecycle.resume_after_compaction as Record<string, string> | undefined
			expect(resume?.["round_status=capability_blocked"]).toBe("report_capability_blocker_and_stop")
		})
	}
})
