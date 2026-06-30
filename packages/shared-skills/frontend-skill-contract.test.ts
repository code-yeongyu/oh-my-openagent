import { describe, expect, test } from "bun:test"

const frontendSkillPath = new URL("./skills/frontend/SKILL.md", import.meta.url)

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

describe("frontend skill Aside reference contract", () => {
	test("#given an Aside-style AI browser brief #when routing design references #then Aside is discoverable and provenance-backed", async () => {
		const skillText = await Bun.file(frontendSkillPath).text()
		const indexText = await Bun.file(new URL("./skills/frontend/references/design/_INDEX.md", import.meta.url)).text()
		const designReadmeText = await Bun.file(new URL("./skills/frontend/references/design/README.md", import.meta.url)).text()
		const asideText = await Bun.file(new URL("./skills/frontend/references/design/aside.md", import.meta.url)).text()

		expect(skillText).toContain("design/aside.md")
		expect(skillText).toContain("Aside-style AI browser")
		expect(indexText).toContain("`aside.md`")
		expect(indexText).toContain("AI browser / agentic browser / product-app launch")
		expect(designReadmeText).toContain("Aside-style browser agent")
		expect(asideText).toContain("## Provenance")
		expect(asideText).toContain("https://aside.com/")
		expect(asideText).toContain("JCodesMore/ai-website-cloner-template")
		expect(asideText).toContain("Do not treat this file as a license to copy")
	})
})
