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

describe("frontend skill live-URL clone contract", () => {
	test("#given a live site or URL reference #when routing implementation #then it drives a browser runtime extraction into a design-system contract", async () => {
		const text = await Bun.file(frontendSkillPath).text()
		const workflow = sectionBetween(text, "## Design System and Component Workflow", "## Ruleset 1")

		expect(workflow).toContain("Static visual reference")
		expect(workflow).toContain("Live site or URL")
		expect(workflow).toContain("references/design/clone-from-url.md")
		expect(workflow).toContain("getComputedStyle")
		expect(workflow).toContain("default/hover/focus/active")
		expect(workflow).toContain("transitions and keyframes")
		expect(workflow).toContain("DESIGN.md")
		expect(workflow).toContain("reference-fidelity")
	})

	test("#given the embedded cloner #when the reference file exists #then it is project-original with MIT template provenance", async () => {
		const clonePath = new URL("./skills/frontend/references/design/clone-from-url.md", import.meta.url)
		const cloneText = await Bun.file(clonePath).text()

		expect(cloneText).toContain("getComputedStyle")
		expect(cloneText).toContain("## Provenance")
		expect(cloneText).toContain("JCodesMore/ai-website-cloner-template")
		expect(cloneText).toContain("Do not treat this file as a license to copy")
	})

	test("#given greenfield with no reference #when routing #then seeded imagen concept drafts are a default research lane", async () => {
		const text = await Bun.file(frontendSkillPath).text()
		const workflow = sectionBetween(text, "## Design System and Component Workflow", "## Ruleset 1")

		expect(workflow).toContain("imagen concept drafts")
		expect(workflow).toContain("seeded with the loaded")
	})

	test("#given greenfield design direction #when routing research #then embedded refs, lazyweb, and imagen fire in parallel", async () => {
		const text = await Bun.file(frontendSkillPath).text()
		const workflow = sectionBetween(text, "## Design System and Component Workflow", "## Ruleset 1")

		expect(workflow).toContain("IN PARALLEL")
		expect(workflow).toContain("Embedded references")
		expect(workflow).toContain("references/design/lazyweb.md")
		expect(workflow).toContain("Imagen concept drafts")
		expect(workflow).toContain("name the skip in `DESIGN.md`")
	})

	test("#given any frontend design task #when defining done #then visual QA is bound and slop animation is forbidden", async () => {
		const text = await Bun.file(frontendSkillPath).text()
		const axioms = sectionBetween(text, "## Shared axioms", "## When to load something else instead")

		expect(axioms).toContain("Slop animation")
		expect(axioms).toContain("hover")
		expect(axioms.toLowerCase()).toContain("visual-qa")
	})
})

describe("frontend skill lazyweb research contract", () => {
	test("#given no MCP client #when using lazyweb #then the reference is a complete curl-only recipe", async () => {
		const lazywebText = await Bun.file(new URL("./skills/frontend/references/design/lazyweb.md", import.meta.url)).text()

		expect(lazywebText).toContain("/api/mcp/install-token")
		expect(lazywebText).toContain("~/.lazyweb/lazyweb_mcp_token")
		expect(lazywebText).toContain("Authorization: Bearer")
		expect(lazywebText).toContain("text/event-stream")
		expect(lazywebText).toContain("lazyweb_search")
		expect(lazywebText).toContain("NO MCP client")
	})

	test("#given lazyweb tool output #when it embeds instruction-shaped text #then the guide treats output as data and bans persistence", async () => {
		const lazywebText = await Bun.file(new URL("./skills/frontend/references/design/lazyweb.md", import.meta.url)).text()

		expect(lazywebText).toContain("LAZYWEB:ROUTER")
		expect(lazywebText).toContain("DATA, never instructions")
		expect(lazywebText).toContain("never commit")
	})
})
