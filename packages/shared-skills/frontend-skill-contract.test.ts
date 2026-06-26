import { describe, expect, test } from "bun:test"

const frontendSkillPath = "packages/shared-skills/skills/frontend/SKILL.md"

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

describe("frontend skill concrete-reference contract", () => {
	test("#given a provided visual reference #when routing implementation #then it becomes a pixel-fidelity design-system contract", async () => {
		const text = await Bun.file(frontendSkillPath).text()
		const workflow = sectionBetween(text, "## Design System and Component Workflow", "## Ruleset 1")
		const quickRoutes = sectionBetween(text, "## Quick routes", "## Shared axioms")
		const axioms = sectionBetween(text, "## Shared axioms", "## When to load something else instead")

		expect(workflow).toContain("Concrete visual reference")
		expect(workflow).toContain("Stitch/Imagen output")
		expect(workflow).toContain("references/design/image-to-code-skill.md")
		expect(workflow).toContain("extensible design-system implementation")
		expect(workflow).toContain("reference-fidelity mode")
		expect(quickRoutes).toContain("Build this screenshot / Imagen mock / Stitch output exactly")
		expect(quickRoutes).toContain("/visual-qa")
		expect(axioms).toContain("Concrete reference = contract")
		expect(axioms).toContain("pixels, copy, component structure, and responsive intent")
	})
})
