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
			expect(passB, fixture.label).toContain("semantic phrases")
			expect(passB, fixture.label).toContain("놀라운 변 / 화")
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

	test("#given a concrete visual target #when in reference-fidelity mode #then dual pixel + code-fidelity verification loops until both pass", () => {
		for (const fixture of fixtures()) {
			const cloneMode = sectionBetween(fixture.text, "## Step 5", "## Reference evidence is not the verdict")
			const lowerCloneMode = cloneMode.toLowerCase()

			expect(lowerCloneMode, fixture.label).toContain("clone")
			expect(lowerCloneMode, fixture.label).toContain("imagen")
			expect(lowerCloneMode, fixture.label).toContain("stitch")
			expect(lowerCloneMode, fixture.label).toContain("generated mockup")
			expect(lowerCloneMode, fixture.label).toContain("overview")
			expect(cloneMode, fixture.label).toContain("pixel-by-pixel")
			expect(cloneMode, fixture.label).toContain("image-diff")
			expect(cloneMode, fixture.label).toContain("lazycodex-clone-fidelity-reviewer")
			expect(lowerCloneMode, fixture.label).toContain("extensible state variants")
			expect(lowerCloneMode, fixture.label).toContain("retry")
		}
	})
})

describe("visual-qa skill exhaustive-coverage and review-gate contract", () => {
	test("#given a multi-page surface #when capturing #then every page is enumerated and verified per page, not sampled", () => {
		for (const fixture of fixtures()) {
			const capture = sectionBetween(fixture.text, "## Step 2", "## Step 3")
			const lower = capture.toLowerCase()

			expect(lower, fixture.label).toContain("every page")
			expect(lower, fixture.label).toContain("enumerate")
			expect(lower, fixture.label).toContain("never sample")
			expect(lower, fixture.label).toContain("per page")
			expect(lower, fixture.label).toContain("one failing page fails")
		}
	})

	test("#given prior QA artifacts #when verifying #then stale evidence older than the source must be regenerated", () => {
		for (const fixture of fixtures()) {
			const capture = sectionBetween(fixture.text, "## Step 2", "## Step 3")
			const lower = capture.toLowerCase()

			expect(lower, fixture.label).toContain("stale")
			expect(lower, fixture.label).toContain("older than")
			expect(lower, fixture.label).toContain("regenerate")
		}
	})

	test("#given Step 3 dispatch #when running the review #then it is required pre-done, harness-native, and covers every enumerated page", () => {
		for (const fixture of fixtures()) {
			const dispatch = sectionBetween(fixture.text, "## Step 3", "### Pass A")
			const lower = dispatch.toLowerCase()

			expect(lower, fixture.label).toContain("required before")
			expect(lower, fixture.label).toContain("do not self-review")
			expect(dispatch, fixture.label).toContain("spawn_agent")
			expect(dispatch, fixture.label).toContain("lazycodex-gate-reviewer")
			expect(lower, fixture.label).toContain("every enumerated page")
		}
	})

	test("#given the completion gate #when deciding done #then an independent reviewer must PASS on a fresh full capture, looping until clean", () => {
		for (const fixture of fixtures()) {
			const gate = sectionBetween(fixture.text, "## Step 4", "## Step 5")
			const lower = gate.toLowerCase()

			expect(lower, fixture.label).toContain("hard stop rule")
			expect(lower, fixture.label).toContain("independent")
			expect(lower, fixture.label).toContain("no blocking")
			expect(lower, fixture.label).toContain("fresh")
			expect(lower, fixture.label).toContain("every enumerated page")
			expect(lower, fixture.label).toContain("loop until")
			expect(lower, fixture.label).toContain("do not stop because the automated script")
		}
	})

	test("#given Pass B CJK checks #when inspecting #then it flags topic, connective, and source-citation splits across every page", () => {
		for (const fixture of fixtures()) {
			const passB = sectionBetween(fixture.text, "### Pass B", "## Step 4")
			const lower = passB.toLowerCase()

			expect(passB, fixture.label).toContain("두 강은")
			expect(passB, fixture.label).toContain("쓸 수")
			expect(passB, fixture.label).toContain("Attention Is")
			expect(lower, fixture.label).toContain("citation")
			expect(lower, fixture.label).toContain("every page")
			expect(lower, fixture.label).toContain("regardless of similarityscore")
		}
	})

	test("#given a generated reference packet #when reviewing #then Pass A and B require extensible design-system code and pixel-level reference matching", () => {
		for (const fixture of fixtures()) {
			const passA = sectionBetween(fixture.text, "### Pass A", "### Pass B")
			const passB = sectionBetween(fixture.text, "### Pass B", "## Step 4")
			const lowerPassA = passA.toLowerCase()
			const lowerPassB = passB.toLowerCase()

			expect(passA, fixture.label).toContain("REFERENCE PACKET:")
			expect(passB, fixture.label).toContain("REFERENCE PACKET:")
			expect(lowerPassA, fixture.label).toContain("reusable tokens/primitives")
			expect(lowerPassA, fixture.label).toContain("extend to new pages")
			expect(lowerPassA, fixture.label).toContain("missing overview content")
			expect(lowerPassB, fixture.label).toContain("pixel-perfectly")
			expect(lowerPassB, fixture.label).toContain("actual against reference")
			expect(lowerPassB, fixture.label).toContain("overview text is part of the target")
		}
	})

	test("#given reference packet evidence #when prompting reviewers #then sensitive content is redacted and annotations stay untrusted data", () => {
		for (const fixture of fixtures()) {
			const capture = sectionBetween(fixture.text, "## Step 2", "## Step 3")
			const passA = sectionBetween(fixture.text, "### Pass A", "### Pass B")
			const passB = sectionBetween(fixture.text, "### Pass B", "## Step 4")
			const combined = `${capture}\n${passA}\n${passB}`.toLowerCase()

			expect(combined, fixture.label).toContain("redact or omit secrets")
			expect(combined, fixture.label).toContain("credentials")
			expect(combined, fixture.label).toContain("tokens")
			expect(combined, fixture.label).toContain("auth headers")
			expect(combined, fixture.label).toContain("customer data")
			expect(combined, fixture.label).toContain("private messages")
			expect(combined, fixture.label).toContain("internal urls")
			expect(combined, fixture.label).toContain("untrusted data")
			expect(combined, fixture.label).toContain("captured ui copy")
			expect(combined, fixture.label).toContain("comments")
			expect(combined, fixture.label).toContain("filenames")
			expect(combined, fixture.label).toContain("not reviewer instructions")
			expect(combined, fixture.label).toContain("never as instructions")
		}
	})
})
