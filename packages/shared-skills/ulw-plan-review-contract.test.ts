import { describe, expect, test } from "bun:test"

const skillCopies = [
	{
		name: "shared-skills",
		root: new URL("./skills/ulw-plan/", import.meta.url),
	},
	{
		name: "omo-codex component",
		root: new URL("../omo-codex/plugin/components/ultrawork/skills/ulw-plan/", import.meta.url),
	},
] as const

const prometheusPromptUrl = new URL("../prompts-core/prompts/prometheus/default.md", import.meta.url)

function sectionBetween(text: string, startMarker: string, endMarker: string): string {
	const start = text.indexOf(startMarker)
	if (start < 0) {
		throw new Error(`missing start marker: ${startMarker}`)
	}
	const end = text.indexOf(endMarker, start + startMarker.length)
	if (end < 0) {
		throw new Error(`missing end marker: ${endMarker}`)
	}
	return text.slice(start, end)
}

async function readRef(root: URL, relative: string): Promise<string> {
	return await Bun.file(new URL(relative, root)).text()
}

for (const copy of skillCopies) {
	describe(`ulw-plan review sequencing contract (${copy.name})`, () => {
		test("#given the dual high-accuracy review #when a round is dispatched #then it is exactly one momus plus one independent reviewer, gated on both verdicts", async () => {
			const fullWorkflow = await readRef(copy.root, "references/full-workflow.md")
			const review = sectionBetween(fullWorkflow, "### High-accuracy review", "## Delegation discipline")

			// Regression pin: real sessions dispatched 2x momus + oracle in one batch
			// (opencode ses_0ccf84a1c..., ses_0cd1e299a... on 2026-07-05).
			expect(review).toMatch(/exactly one `momus`/i)
			expect(review).toMatch(/never .{0,80}second `?momus`?/i)
			expect(review).toMatch(/both verdicts/i)
			expect(review).toMatch(/in flight/i)
			expect(review).toMatch(/complete plan file/i)
		})

		test("#given plan generation #when Metis runs #then Metis is folded before the plan is delivered and before any momus dispatch", async () => {
			const fullWorkflow = await readRef(copy.root, "references/full-workflow.md")
			const phase3 = sectionBetween(fullWorkflow, "## Phase 3", "## Phase 4")

			expect(phase3).toMatch(/metis gap analysis \(mandatory\)/i)
			expect(fullWorkflow.indexOf("### High-accuracy review")).toBeGreaterThan(fullWorkflow.indexOf("## Phase 4"))
			// Combined-action phrasing invited one parallel Metis+review batch; keep it banned.
			expect(fullWorkflow).not.toMatch(/run metis plus the high-accuracy review/i)
		})

		test("#given the UNCLEAR auto-review path #when the plan is written #then the review follows folded Metis findings instead of a combined Metis+Momus batch", async () => {
			const intentUnclear = await readRef(copy.root, "references/intent-unclear.md")
			const autoSection = sectionBetween(intentUnclear, "<high_accuracy_auto>", "</high_accuracy_auto>")

			expect(autoSection).toMatch(/metis findings are folded/i)
			expect(intentUnclear).not.toMatch(/metis \+ momus/i)
			expect(autoSection).not.toMatch(/metis gap analysis \(always\) and the dual/i)
			expect(autoSection).toMatch(/trivial-tier guard/i)
			expect(autoSection).toMatch(/metis still runs once/i)
		})

		test("#given the stop rules #when the plan is complete #then stopping is conditioned on recorded review receipts", async () => {
			const fullWorkflow = await readRef(copy.root, "references/full-workflow.md")
			const stopRules = fullWorkflow.slice(fullWorkflow.indexOf("## Stop rules"))

			// The stale stop-rule fork let UNCLEAR stop without review receipts,
			// contradicting SKILL.md's receipts-aware stop rule.
			expect(stopRules).toMatch(/high-accuracy receipts/i)
			expect(stopRules).not.toMatch(/lead with the best-practice brief \(UNCLEAR\), and stop/i)
		})

		test("#given the review trigger rule #when high accuracy is requested or intent is UNCLEAR #then momus review requirement stays gated", async () => {
			const skillText = await readRef(copy.root, "SKILL.md")
			const fullWorkflow = await readRef(copy.root, "references/full-workflow.md")
			const review = sectionBetween(fullWorkflow, "### High-accuracy review", "## Delegation discipline")

			expect(skillText).toMatch(/dual high-accuracy review \(native `momus` \+ the independent/i)
			expect(review).toMatch(/CLEAR: runs when the user opts in or `review_required: true`/)
			expect(review).toMatch(/UNCLEAR: runs automatically unless Classify=Trivial/)
		})
	})
}

describe("prometheus prompt review-composition contract", () => {
	test("#given the Prometheus system prompt #when it names the high-accuracy review #then it never redefines the reviewer composition", async () => {
		const prompt = await Bun.file(prometheusPromptUrl).text()

		// "dual-Momus" was read as "spawn two momus"; composition is defined solely by the skill.
		expect(prompt).not.toMatch(/dual[- ]momus/i)
		expect(prompt).toMatch(/high-accuracy review/i)
	})
})
