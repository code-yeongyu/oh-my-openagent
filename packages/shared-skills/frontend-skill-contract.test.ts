import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const frontendSkillPath = new URL("./skills/frontend/SKILL.md", import.meta.url)

function tableRowFor(text: string, rowStart: string): string {
	const row = text.split("\n").find((line) => line.startsWith(rowStart))
	if (!row) {
		throw new Error(`missing table row: ${rowStart}`)
	}
	return row
}

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

describe("frontend skill taste-skill v2 routing contract", () => {
	const designReadmeUrl = new URL("./skills/frontend/references/design/README.md", import.meta.url)
	const indexUrl = new URL("./skills/frontend/references/design/_INDEX.md", import.meta.url)

	test("#given an operational brief #when routing Layer A #then it routes to the official design-system map, not taste-skill marketing defaults", async () => {
		const readme = await Bun.file(designReadmeUrl).text()
		const step2 = sectionBetween(readme, "### Step 2", "### Step 3")

		expect(step2).toContain("Brief → Design System Map")
		expect(step2).toContain("official design system")
		for (const system of ["Fluent", "Carbon", "GOV.UK"]) {
			expect(step2).toContain(system)
		}
		expect(step2).not.toContain("`taste-skill` is the right default")
	})

	test("#given router descriptions of taste-skill #when compared with its v2 scope #then they describe the brief-inference marketing workflow", async () => {
		const skillText = await Bun.file(frontendSkillPath).text()
		const indexText = await Bun.file(indexUrl).text()

		const skillRow = tableRowFor(skillText, "| `taste-skill.md` |")
		expect(skillRow).toContain("Design Read")
		expect(skillRow).toContain("pre-flight")
		expect(skillRow.toLowerCase()).not.toContain("safe default")

		const indexRow = tableRowFor(indexText, "| `taste-skill.md` |")
		expect(indexRow).toContain("Design Read")
		expect(indexRow.toLowerCase()).not.toContain("safe default")
	})
})

describe("frontend skill design-read planning contract", () => {
	const architectureUrl = new URL("./skills/frontend/references/design/design-system-architecture.md", import.meta.url)
	const designReadmeUrl2 = new URL("./skills/frontend/references/design/README.md", import.meta.url)

	test("#given a new DESIGN.md #when the contract is created #then it opens with a Design Read and dial prelude", async () => {
		const architecture = await Bun.file(architectureUrl).text()

		expect(architecture).toContain("## 0. Design Read")
		for (const dial of ["DESIGN_VARIANCE", "MOTION_INTENSITY", "VISUAL_DENSITY"]) {
			expect(architecture).toContain(dial)
		}
		expect(architecture).toContain("Brief → Design System Map")
	})

	test("#given the design system gate #when committing a direction #then the Design Read is recorded into DESIGN.md", async () => {
		const readme = await Bun.file(designReadmeUrl2).text()
		const gate = sectionBetween(readme, "## Phase 0 — Design System Gate", "## Phase 0.5")

		expect(gate).toContain("Design Read")
		expect(gate).toContain("dial")
	})
})

describe("frontend skill taste pre-flight QA contract", () => {
	const designReadmeUrl3 = new URL("./skills/frontend/references/design/README.md", import.meta.url)

	test("#given a taste Layer A is loaded #when running design QA #then the taste pre-flight gate runs before visual-qa", async () => {
		const readme = await Bun.file(designReadmeUrl3).text()
		const qa = sectionBetween(readme, "## Phase Final", "## Final notes")

		expect(qa.toLowerCase()).toContain("pre-flight")
		expect(qa).toContain("gpt-tasteskill")
		expect(qa).toContain("/visual-qa")
	})

	test("#given a marketing redesign #when routing #then taste-skill preservation rules are honored", async () => {
		const readme = await Bun.file(designReadmeUrl3).text()
		const step3 = sectionBetween(readme, "### Step 3", "### Step 4")

		expect(step3).toContain("never silently")
		expect(step3).toContain("URL slugs")
	})

	test("#given the vendored taste-skill upstream #when synced #then the v2 markers the router relies on still exist", async () => {
		const upstreamUrl = new URL("./upstreams/taste-skill/skills/taste-skill/SKILL.md", import.meta.url)
		if (!existsSync(fileURLToPath(upstreamUrl))) return
		const taste = await Bun.file(upstreamUrl).text()

		expect(taste).toContain("BRIEF INFERENCE")
		expect(taste).toContain("DESIGN SYSTEM MAP")
		expect(taste).toContain("FINAL PRE-FLIGHT CHECK")
		expect(taste).toContain("Not dashboards")
	})
})

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

	test("#given expressive greenfield with no reference #when routing #then it defaults to seeded imagen concept drafts", async () => {
		const text = await Bun.file(frontendSkillPath).text()
		const workflow = sectionBetween(text, "## Design System and Component Workflow", "## Ruleset 1")

		expect(workflow).toContain("imagen concept drafts")
		expect(workflow).toContain("seeded with the loaded")
	})

	test("#given any frontend design task #when defining done #then visual QA is bound and slop animation is forbidden", async () => {
		const text = await Bun.file(frontendSkillPath).text()
		const axioms = sectionBetween(text, "## Shared axioms", "## When to load something else instead")

		expect(axioms).toContain("Slop animation")
		expect(axioms).toContain("hover")
		expect(axioms.toLowerCase()).toContain("visual-qa")
	})
})
