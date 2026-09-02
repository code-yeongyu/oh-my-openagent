/**
 * QA driver for issue 6754 - exercises the REAL skill-loading surface
 * (skills-loader-core) against the shipped shared-skills artifacts in the
 * worktree, under a sandboxed environment. Run via run-qa.sh which sets the
 * isolated XDG/HOME env. Observational evidence only - not a repo test.
 */
import { createBuiltinSkills } from "@oh-my-opencode/skills-loader-core/builtin-skills"
import { loadSkillsFromDir } from "@oh-my-opencode/skills-loader-core/opencode-skill-loader"
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills"
import { parseFrontmatter } from "@oh-my-opencode/utils"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const results: string[] = []
function record(name: string, ok: boolean, detail: string): void {
	results.push(`${ok ? "PASS" : "FAIL"} ${name} - ${detail}`)
	if (!ok) process.exitCode = 1
}

const skillsRoot = sharedSkillsRootPath()
record("shared-skills root resolves into this worktree", skillsRoot.includes("oom-wt-6754"), skillsRoot)

// 1. Real shared-skill directory loading (the OpenCode runtime path)
const loaded = await loadSkillsFromDir({ skillsDir: skillsRoot, scope: "shared" })
const visualQa = loaded.find((s) => s.name === "visual-qa")
record("visual-qa loads via loadSkillsFromDir", visualQa !== undefined, `${loaded.length} shared skills loaded`)
if (visualQa) {
	const template = visualQa.definition.template
	const source = readFileSync(join(skillsRoot, "visual-qa", "SKILL.md"), "utf8")
	const fm = parseFrontmatter<{ name?: string; description?: string }>(source)
	record(
		"visual-qa frontmatter parses with tier clause",
		fm.hadFrontmatter && !fm.parseError && (fm.data.description?.includes("Risk selects the verification tier") ?? false),
		`description length ${(fm.data.description ?? "").length}`,
	)
	record(
		"loaded visual-qa body carries Step 0 tier gate",
		template.includes("Classify the verification tier by risk") && template.includes("static-document fast path"),
		"tier gate present in loaded template",
	)
}

// 2. Builtin wrapper path (what agent prompt assembly consumes)
const builtin = createBuiltinSkills().find((s) => s.name === "visual-qa")
record("builtin visual-qa wrapper loads", builtin !== undefined, `template bytes ${builtin?.template.length ?? 0}`)
if (builtin && visualQa) {
	const wrapperMatchesSource =
		builtin.description ===
		parseFrontmatter<{ description?: string }>(readFileSync(join(skillsRoot, "visual-qa", "SKILL.md"), "utf8")).data.description
	record("wrapper description equals shipped frontmatter", wrapperMatchesSource, "equality between real artifacts")
}

// 3. Frontend skill still parses after done-gate scoping
const frontend = loaded.find((s) => s.name === "frontend")
record("frontend loads via loadSkillsFromDir", frontend !== undefined, frontend ? `template bytes ${frontend.definition.template.length}` : "missing")

// 4. Ultrawork prompts bundle + parse through prompts-core real loader
const { ultraworkPromptVariants, codexUltraworkPromptVariants } = await import("@oh-my-opencode/prompts-core")
for (const [name, variant] of Object.entries({ ...ultraworkPromptVariants, ...codexUltraworkPromptVariants })) {
	const parsed = parseFrontmatter(variant.content)
	record(`ultrawork/${name} bundles and parses`, typeof variant.content === "string" && !parsed.parseError, `${variant.filePath} (${variant.content.length} bytes)`)
}
const defaultRow = ultraworkPromptVariants.default.content.match(/Changes UI rendering or a TUI[^\n]*/)
record(
	"default QA row defers to risk tier",
	defaultRow !== null && defaultRow[0].includes("follow its risk tier") && defaultRow[0].includes("static-document fast path"),
	"row updated in bundled content",
)

console.log(results.join("\n"))
console.log(`\nTOTAL: ${results.filter((r) => r.startsWith("PASS")).length}/${results.length} checks pass`)
