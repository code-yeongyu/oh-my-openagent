import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

const repoRoot = findRepoRoot(import.meta.dir)
const sharedSkillPath = join(repoRoot, "packages", "shared-skills", "skills", "visual-qa", "SKILL.md")
const codexSkillPath = join(repoRoot, "packages", "omo-codex", "plugin", "skills", "visual-qa", "SKILL.md")
const referencesPath = join(
	repoRoot,
	"packages",
	"shared-skills",
	"skills",
	"visual-qa",
	"references",
	"agent-browser-setup.md",
)

type PromptFixture = {
	readonly label: string
	readonly text: string
}

function readPrompt(path: string): string {
	return readFileSync(path, "utf8")
}

function findRepoRoot(start: string): string {
	let current = start
	while (true) {
		if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) {
			return current
		}
		const parent = dirname(current)
		if (parent === current) {
			throw new Error(`repository root not found from ${start}`)
		}
		current = parent
	}
}

function fixtures(): readonly PromptFixture[] {
	const promptFixtures: PromptFixture[] = [{ label: "shared skill", text: readPrompt(sharedSkillPath) }]
	if (existsSync(codexSkillPath)) {
		promptFixtures.push({ label: "codex plugin copy", text: readPrompt(codexSkillPath) })
	}
	return promptFixtures
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

describe("visual-qa skill prompt contract", () => {
	test("#given visual QA prompts #when dispatching pass B #then the oracle must directly inspect screenshots and content for CJK wrapping", () => {
		for (const fixture of fixtures()) {
			const passB = sectionBetween(fixture.text, "### Pass B", "## Step 4")
			const lowerPassB = passB.toLowerCase()

			expect(lowerPassB, fixture.label).toContain("directly open")
			expect(lowerPassB, fixture.label).toContain("view_image")
			expect(lowerPassB, fixture.label).toContain("source code")
			expect(passB, fixture.label).toContain("[Image #1]")
			expect(passB, fixture.label).toContain("에이전트 오케스트")
			expect(passB, fixture.label).toContain("레이션 현황 및 미")
			expect(passB, fixture.label).toContain("래")
			expect(passB, fixture.label).toContain("REVISE/FAIL")
		}
	})

	test("#given visual QA prompts #when dispatching pass A #then the oracle must reject mock-only UI instead of accepting superficial screenshots", () => {
		for (const fixture of fixtures()) {
			const passA = sectionBetween(fixture.text, "### Pass A", "### Pass B")
			const checkBlock = sectionBetween(passA, "CHECK EACH:", "OUTPUT:")
			const outputBlock = sectionBetween(passA, "OUTPUT:", '"""')
			const lowerCheckBlock = checkBlock.toLowerCase()

			expect(lowerCheckBlock, fixture.label).toContain("mock-only")
			expect(lowerCheckBlock, fixture.label).toContain("faked-with-an-image")
			expect(lowerCheckBlock, fixture.label).toContain("coherent design tokens")
			expect(lowerCheckBlock, fixture.label).toContain("reused primitives")
			expect(lowerCheckBlock, fixture.label).toContain("blocking")
			expect(outputBlock, fixture.label).toContain("BLOCKING:")
		}
	})

	test("#given the Web capture path #when no browser tooling is configured #then it falls back to agent-browser", () => {
		for (const fixture of fixtures()) {
			const web = sectionBetween(fixture.text, "### Web", "### TUI")

			expect(web, fixture.label).toContain("agent-browser")
			expect(fixture.text, fixture.label).toContain("bun add -g agent-browser")
			expect(fixture.text, fixture.label).toContain("https://github.com/vercel-labs/agent-browser")
			expect(fixture.text, fixture.label).toContain("references/agent-browser-setup.md")
		}
	})

	test("#given the agent-browser fallback #when documenting setup #then a references doc lists install, link, and help", () => {
		expect(existsSync(referencesPath)).toBe(true)
		const doc = readFileSync(referencesPath, "utf8")

		expect(doc).toContain("bun add -g agent-browser")
		expect(doc).toContain("agent-browser install")
		expect(doc).toContain("https://github.com/vercel-labs/agent-browser")
		expect(doc).toContain("agent-browser --help")
	})

	test("#given a clone/design-port task #when in clone-coding mode #then dual pixel + code-fidelity verification loops until both pass", () => {
		for (const fixture of fixtures()) {
			const cloneMode = sectionBetween(fixture.text, "## Step 5", "## Reference evidence is not the verdict")
			const lowerCloneMode = cloneMode.toLowerCase()

			expect(lowerCloneMode, fixture.label).toContain("clone")
			expect(cloneMode, fixture.label).toContain("pixel-by-pixel")
			expect(cloneMode, fixture.label).toContain("image-diff")
			expect(cloneMode, fixture.label).toContain("lazycodex-clone-fidelity-reviewer")
			expect(lowerCloneMode, fixture.label).toContain("retry")
		}
	})
})
