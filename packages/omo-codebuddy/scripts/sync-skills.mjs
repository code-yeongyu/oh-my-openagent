#!/usr/bin/env node
/**
 * Syncs the shared omo skill pool into the CodeBuddy plugin.
 *
 * Source of truth: `@oh-my-opencode/shared-skills` (the same pool the OpenCode
 * and Codex editions ship). This script is a TRANSFORMER, never an author:
 *  - it copies the pool verbatim (minus caches/tests) through the shared copy
 *    filter,
 *  - it generates the `ultrawork` skill from the canonical directive in
 *    `@oh-my-opencode/prompts-core`,
 *  - and it adapts every skill to the CodeBuddy harness: other harnesses'
 *    compatibility sections are stripped, a CodeBuddy compatibility section is
 *    inserted when the body still carries OpenCode-only vocabulary, and
 *    harness session prefixes are normalized to `codebuddy:`.
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ULTRAWORK_DEFAULT_PROMPT } from "@oh-my-opencode/prompts-core";
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills";
import { createSkillSourceCopyFilter } from "@oh-my-opencode/shared-skills/skill-source-filter";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginSkillsRoot = join(packageRoot, "plugin", "skills");

export const CODEBUDDY_COMPAT_HEADING = "## CodeBuddy Harness Tool Compatibility";

/**
 * Explicit delimiters around OUR compatibility section.
 *
 * Without them the section boundary has to be guessed from markdown headings,
 * and a skill body that contains code (the `refactor` skill embeds a TS
 * template literal starting with `# Intelligent Refactor Command`) makes the
 * guess land INSIDE the code — the strip then eats the body. The markers make
 * the removal exact, which is what keeps `adaptSkillForCodeBuddy` idempotent.
 */
export const CODEBUDDY_COMPAT_MARKER_START = "<!-- omo:codebuddy-compat -->";
export const CODEBUDDY_COMPAT_MARKER_END = "<!-- /omo:codebuddy-compat -->";

const FOREIGN_COMPAT_HEADINGS = [
	"## Codex Harness Tool Compatibility",
	"## Senpi Harness Tool Compatibility",
];

const opencodeOnlyPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|load_skills)\b/;
const bashFallbackNote =
	"CodeBuddy Code runs hooks through Git Bash on Windows; inside a session, prefer the native tools over shell pipelines when a native tool exists.";

export const codebuddyCompatibilitySection = `${CODEBUDDY_COMPAT_MARKER_START}
${CODEBUDDY_COMPAT_HEADING}

Some examples in this skill were written for the OpenCode harness. In CodeBuddy, translate them instead of copying them literally:

| OpenCode example | CodeBuddy equivalent |
| --- | --- |
| \`call_omo_agent(subagent_type="explore", ...)\` | the \`task\` tool with the matching omo agent (\`subagent_name: "explore"\`), or \`background_task\` for parallel fan-out |
| \`task(category="deep", ...)\` | the \`task\` tool with the closest agent: \`oracle\` for deep reasoning and review, \`explore\` for codebase search, \`librarian\` for external research |
| \`background_output(task_id=...)\` | collect the subagent's returned result; there is no separate output tool |
| \`team_*(...)\` | not available in CodeBuddy — use \`task\` / \`background_task\` subagents instead |
| \`load_skills: ["x"]\` | name the skill inside the subagent prompt, or read \`\${CODEBUDDY_PLUGIN_ROOT}/skills/x/SKILL.md\` |
| a bare \`skill(name="x")\` call | \`/omo:x\`, or read the skill file directly |

${bashFallbackNote}

If a code block below conflicts with this section, this section wins.
${CODEBUDDY_COMPAT_MARKER_END}
`;

/**
 * Removes a section and NORMALIZES the seam to exactly one blank line.
 *
 * The normalization is what makes `adaptSkillForCodeBuddy` idempotent: a plain
 * slice leaves one blank line where two used to be (or none where two are
 * expected), so re-adapting an already-adapted file used to produce a third,
 * different body — caught by `build-plugin.mjs --check` on `init-deep`,
 * `refactor` and `review-work`.
 */
export function stripSection(content, heading) {
	let without = content;
	for (;;) {
		const start = without.indexOf(heading);
		if (start === -1) return without;
		const end = findSectionEnd(without, start + heading.length);
		const beforeRaw = without.slice(0, start).replace(/\n+$/, "");
		const after = without.slice(end).replace(/^\n+/, "");
		without = beforeRaw.length === 0 ? after : `${beforeRaw}\n\n${after}`;
	}
}

function findSectionEnd(content, from) {
	const pattern = /\n(?:---|#{1,6}\s)/g;
	pattern.lastIndex = from;
	const match = pattern.exec(content);
	return match ? match.index + 1 : content.length;
}

export function normalizeHarnessPrefixes(content) {
	return content
		.replace(/\bcodex:/g, "codebuddy:")
		.replace(/\bsenpi:/g, "codebuddy:")
		.replace(/`\/skill:([a-z0-9-]+)`/g, "`/omo:$1`");
}

export function insertCodeBuddyCompatibility(content) {
	if (!opencodeOnlyPattern.test(content)) return content;
	const anchor = frontmatterEnd(content);
	// Normalize the seam the same way `stripSection` does, so insert(strip(x))
	// is stable no matter how many blank lines the source carried.
	const head = content.slice(0, anchor).replace(/\n+$/, "");
	const tail = content.slice(anchor).replace(/^\n+/, "");
	const prefix = head.length === 0 ? "" : `${head}\n\n`;
	return `${prefix}${codebuddyCompatibilitySection}\n\n${tail}`;
}

function frontmatterEnd(content) {
	if (!content.startsWith("---\n")) return 0;
	const end = content.indexOf("\n---", 4);
	if (end === -1) return 0;
	const after = content.indexOf("\n", end + 1);
	return after === -1 ? content.length : after + 1;
}

/** Removes OUR section by its explicit markers, normalizing the same seam. */
export function stripMarkedCompatibilitySection(content) {
	const start = content.indexOf(CODEBUDDY_COMPAT_MARKER_START);
	if (start === -1) return content;
	const end = content.indexOf(CODEBUDDY_COMPAT_MARKER_END, start);
	if (end === -1) return content;
	const beforeRaw = content.slice(0, start).replace(/\n+$/, "");
	const after = content.slice(end + CODEBUDDY_COMPAT_MARKER_END.length).replace(/^\n+/, "");
	return beforeRaw.length === 0 ? after : `${beforeRaw}\n\n${after}`;
}

export function adaptSkillForCodeBuddy(content) {
	// Ours first and EXACTLY (markers), then the other harnesses' sections by
	// heading (they are foreign input and only ever need to be removed once).
	let adapted = stripMarkedCompatibilitySection(content);
	for (const heading of FOREIGN_COMPAT_HEADINGS) adapted = stripSection(adapted, heading);
	adapted = stripSection(adapted, CODEBUDDY_COMPAT_HEADING);
	adapted = normalizeHarnessPrefixes(adapted);
	adapted = insertCodeBuddyCompatibility(adapted);
	return adapted;
}

async function compareArtifact(path, expected, name, problems) {
	let actual = null;
	try {
		actual = await readFile(path, "utf8");
	} catch {
		problems.push(`${name}: missing`);
		return;
	}
	if (actual !== expected) problems.push(`${name}: stale`);
}

async function listSkillDirs(root) {
	const entries = await readdir(root, { withFileTypes: true });
	return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

const ULTRAWORK_SKILL_FRONTMATTER = [
	"---",
	"name: ultrawork",
	"description: Binding ultrawork mode directive for omo on CodeBuddy. When a prompt contains ultrawork or ulw, the omo UserPromptSubmit hook injects a short bootstrap pointing at this file. Read the whole file and follow every rule in it for the rest of the task.",
	"---",
	"",
	"",
].join("\n");

/** The exact bytes `plugin/skills/ultrawork/SKILL.md` must contain. */
export function ultraworkSkillContent() {
	return adaptSkillForCodeBuddy(`${ULTRAWORK_SKILL_FRONTMATTER}${ULTRAWORK_DEFAULT_PROMPT.trim()}\n`);
}

async function writeUltraworkSkill() {
	const dir = join(pluginSkillsRoot, "ultrawork");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), ultraworkSkillContent(), "utf8");
}

export async function syncSkills({ check = false } = {}) {
	const sourceRoot = sharedSkillsRootPath();
	const skillNames = await listSkillDirs(sourceRoot);

	if (check) {
		// The check compares each artifact against what the CURRENT source
		// produces — not "does re-adapting the artifact change it" — so a source
		// edit that the build has not been re-run for is always caught.
		const problems = [];
		for (const name of skillNames) {
			const expected = adaptSkillForCodeBuddy(await readFile(join(sourceRoot, name, "SKILL.md"), "utf8"));
			await compareArtifact(join(pluginSkillsRoot, name, "SKILL.md"), expected, name, problems);
		}
		await compareArtifact(join(pluginSkillsRoot, "ultrawork", "SKILL.md"), ultraworkSkillContent(), "ultrawork", problems);
		if (problems.length > 0) throw new Error(`skill sync is stale:\n${problems.join("\n")}`);
		return { skillNames: [...skillNames, "ultrawork"] };
	}

	await rm(pluginSkillsRoot, { recursive: true, force: true });
	await mkdir(pluginSkillsRoot, { recursive: true });

	for (const name of skillNames) {
		const from = join(sourceRoot, name);
		const to = join(pluginSkillsRoot, name);
		await cp(from, to, { recursive: true, filter: createSkillSourceCopyFilter(from, { ignoredFileNames: ["openai.yaml"] }) });
	}

	await writeUltraworkSkill();

	const adapted = [];
	for (const name of [...skillNames, "ultrawork"]) {
		const skillPath = join(pluginSkillsRoot, name, "SKILL.md");
		const content = await readFile(skillPath, "utf8");
		const next = adaptSkillForCodeBuddy(content);
		if (next !== content) {
			await writeFile(skillPath, next, "utf8");
			adapted.push(name);
		}
	}

	return { skillNames: [...skillNames, "ultrawork"], adapted };
}

if (import.meta.main) {
	const check = process.argv.includes("--check");
	const result = await syncSkills({ check });
	console.log(
		check
			? `skill sync check passed (${result.skillNames.length} skills)`
			: `synced ${result.skillNames.length} skills (adapted: ${result.adapted.join(", ") || "none"})`,
	);
}
