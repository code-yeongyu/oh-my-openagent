import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(root, "..", "..", "..");
const CONTEXT_PRESSURE_SKILL_BUDGET_BYTES = 25_000;

const expectedSkills = [
	"comment-checker",
	"debugging",
	"frontend-ui-ux",
	"init-deep",
	"lcx-report-bug",
	"lsp",
	"programming",
	"refactor",
	"remove-ai-slops",
	"review-work",
	"rules",
	"start-work",
	"ulw-loop",
	"ulw-plan",
];

const componentSkillSources = [
	["comment-checker", "components/comment-checker/skills/comment-checker"],
	["lsp", "components/lsp/skills/lsp"],
	["rules", "components/rules/skills/rules"],
	["ulw-loop", "components/ulw-loop/skills/ulw-loop"],
];

const codexCompatibilityEndMarkers = [
	"Codex full-history forks inherit the parent agent type, model, and reasoning effort, so role-specific spawns with `agent_type` must use a non-full-history fork mode such as `fork_turns=\"none\"`. Include any required conversation context, files, diffs, constraints, and requested skill names directly in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
	"When translating `load_skills=[...]`, include the requested skill names in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
	"When translating `load_skills=[...]`, name the skills inside the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
];

function removeCodexCompatibilityGuidance(content) {
	const start = content.indexOf("## Codex Harness Tool Compatibility\n\n");
	if (start === -1) return content;
	const endMarker = codexCompatibilityEndMarkers.find((marker) => content.indexOf(marker, start) !== -1);
	assert.notEqual(endMarker, undefined, "Codex compatibility guidance block is missing its terminator");
	const end = content.indexOf(endMarker, start);
	assert.notEqual(end, -1, "Codex compatibility guidance block is missing its terminator");
	return `${content.slice(0, start)}${content.slice(end + endMarker.length)}`;
}

test("#given synced aggregate Codex skills #when inspected #then component and shared skills are present", async () => {
	// given
	const skillsRoot = join(root, "skills");

	// when
	const skillNames = (await readdir(skillsRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	// then
	assert.deepEqual(skillNames, expectedSkills);
	for (const skillName of expectedSkills) {
		const content = await readFile(join(skillsRoot, skillName, "SKILL.md"), "utf8");
		assert.match(removeCodexCompatibilityGuidance(content), /^---\r?\n/);
	}
});

test("#given aggregate Codex skills #when source wiring is inspected #then shared skills are imported from the shared-skills package", async () => {
	// given
	const pluginPackageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
	const sharedPackageJson = JSON.parse(await readFile(join(root, "..", "..", "shared-skills", "package.json"), "utf8"));
	const rootPackageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
	const syncScript = await readFile(join(root, "scripts", "sync-skills.mjs"), "utf8");

	// when
	const sharedSkillDependency = pluginPackageJson.dependencies?.["@oh-my-opencode/shared-skills"];
	const rootPackageFiles = rootPackageJson.files ?? [];

	// then
	assert.equal(sharedPackageJson.exports?.["."], "./index.mjs");
	assert.equal(sharedPackageJson.files?.includes("skills"), true);
	assert.equal(rootPackageFiles.includes("packages/shared-skills/package.json"), true);
	assert.equal(rootPackageFiles.includes("packages/shared-skills/index.mjs"), true);
	assert.equal(rootPackageFiles.includes("packages/shared-skills/skills"), true);
	assert.equal(sharedSkillDependency, "file:../../shared-skills");
	assert.match(syncScript, /from "@oh-my-opencode\/shared-skills"/);
	assert.doesNotMatch(syncScript, /shared-skills",\s*"skills"/);
});

test("#given shared skill package source #when aggregate Codex shared skills are inspected #then generated copies have no hand-authored drift", async () => {
	// given
	const sharedSkillsRoot = sharedSkillsRootPath();
	const aggregateSkillsRoot = join(root, "skills");
	const sharedSkillNames = (await readdir(sharedSkillsRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	// when / then
	for (const skillName of sharedSkillNames) {
		const sharedContent = await readFile(join(sharedSkillsRoot, skillName, "SKILL.md"), "utf8");
		const aggregateContent = await readFile(join(aggregateSkillsRoot, skillName, "SKILL.md"), "utf8");
		assert.equal(
			removeCodexCompatibilityGuidance(aggregateContent),
			removeCodexCompatibilityGuidance(sharedContent),
			`${skillName} drifted from shared-skills`,
		);
	}
});

test("#given component skill sources #when aggregate Codex component skills are inspected #then generated copies have no hand-authored drift", async () => {
	// given
	const aggregateSkillsRoot = join(root, "skills");

	// when / then
	for (const [skillName, sourcePath] of componentSkillSources) {
		const sourceContent = await readFile(join(root, sourcePath, "SKILL.md"), "utf8");
		const aggregateContent = await readFile(join(aggregateSkillsRoot, skillName, "SKILL.md"), "utf8");
		assert.equal(
			removeCodexCompatibilityGuidance(aggregateContent),
			removeCodexCompatibilityGuidance(sourceContent),
			`${skillName} drifted from its component skill source`,
		);
	}
});

test("#given synced ulw-loop skill #when Codex hint metadata is inspected #then ulw-loop surfaces the ulw-loop alias", async () => {
	// given
	const skillRoot = join(root, "skills", "ulw-loop");

	// when
	const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const interfaceMetadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	// then
	assert.match(skill, /^---\r?\nname: ulw-loop\r?\n/m);
	assert.match(skill, /Goal-like loop that uses ultrawork mode to decompose work into systematic, evidence-bound steps\./);
	assert.match(interfaceMetadata, /display_name: "ulw-loop \(omo\)"/);
	assert.doesNotMatch(interfaceMetadata, /ulw-loop \/ ulw-loop/);
	assert.match(interfaceMetadata, /short_description: "Goal-like ultrawork loop for systematic decomposition"/);
	assert.match(interfaceMetadata, /default_prompt: "Use \$ulw-loop/);
});

test("#given synced ulw-loop skill #when Codex hint metadata is inspected #then ulw-loop remains discoverable as an alias", async () => {
	// given
	const skillRoot = join(root, "skills", "ulw-loop");

	// when
	const interfaceMetadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	// then
	assert.match(interfaceMetadata, /search_terms:/);
	assert.match(interfaceMetadata, /- "ulw-loop"/);
});

test("#given synced lcx-report-bug skill #when inspected #then it files LazyCodex bug issues from proven debugging evidence", async () => {
	// given
	const skillRoot = join(root, "skills", "lcx-report-bug");

	// when
	const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const interfaceMetadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	// then
	assert.match(skill, /^---\r?\nname: lcx-report-bug\r?\n/m);
	assert.match(skill, /code-yeongyu\/lazycodex/);
	assert.match(skill, /\$omo:debugging/);
	assert.match(skill, /gh issue create --repo code-yeongyu\/lazycodex/);
	assert.match(skill, /Browser use fallback/);
	assert.match(skill, /Computer use fallback/);
	assert.match(skill, /## Issue Body Template/);
	assert.match(interfaceMetadata, /display_name: "lcx-report-bug \(omo\)"/);
	assert.match(interfaceMetadata, /- "lazycodex bug"/);
});

test("#given synced ulw-loop skill #when worker guidance is inspected #then context-hygiene guidance matches the source", async () => {
	// given
	const sourceSkill = await readFile(
		join(root, "components", "ulw-loop", "skills", "ulw-loop", "references", "full-workflow.md"),
		"utf8",
	);
	const syncedSkill = await readFile(join(root, "skills", "ulw-loop", "SKILL.md"), "utf8");
	const syncedWorkflow = await readFile(join(root, "skills", "ulw-loop", "references", "full-workflow.md"), "utf8");
	const requiredPatterns = [
		["list_agents polling guard", /list_agents/],
		["status polling warning", /polling or status tool/],
		["large payload replay risk", /replay large agent status and latest-message payloads/],
		["local spawned-name tracking", /Track spawned agent names locally/],
		["wait_agent completion path", /wait_agent.*completion/],
		["targeted followups", /targeted followups only when needed/],
		["close_agent cleanup", /close_agent.*after integrating each result/],
		["long-running plan/reviewer background guidance", /Plan and reviewer agents may run for a long time/],
		["bounded plan/reviewer polling", /short wait_agent cycles/],
		["single long wait guard", /single long blocking wait/],
	];

	// when / then
	for (const [label, pattern] of requiredPatterns) {
		assert.match(sourceSkill, pattern, `source skill missing ${label}`);
		assert.match(syncedWorkflow, pattern, `synced workflow missing ${label}`);
	}
	assert.match(syncedSkill, /references\/full-workflow\.md/);
	assert.match(syncedSkill, /wait_agent/);
	assert.match(syncedSkill, /close_agent/);
});

test("#given context-pressure-prone skills #when bundled for Codex #then the eagerly loaded payload stays budgeted", async () => {
	// given
	const skillsRoot = join(root, "skills");
	const skillNames = ["debugging", "ulw-loop"];

	// when
	let totalBytes = 0;
	for (const skillName of skillNames) {
		const content = await readFile(join(skillsRoot, skillName, "SKILL.md"), "utf8");
		totalBytes += Buffer.byteLength(content, "utf8");
	}

	// then
	assert.ok(
		totalBytes <= CONTEXT_PRESSURE_SKILL_BUDGET_BYTES,
		`debugging + ulw-loop eager payload is ${totalBytes} bytes, above ${CONTEXT_PRESSURE_SKILL_BUDGET_BYTES}`,
	);
});

test("#given synced aggregate Codex skills #when they contain OpenCode orchestration examples #then Codex tool compatibility guidance is injected", async () => {
	// given
	const skillsRoot = join(root, "skills");
	const opencodeOnlyToolPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/;

	// when
	const skillNames = (await readdir(skillsRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	// then
	for (const skillName of skillNames) {
		const content = await readFile(join(skillsRoot, skillName, "SKILL.md"), "utf8");
		if (!opencodeOnlyToolPattern.test(content)) continue;

		const compatibilityIndex = content.indexOf("## Codex Harness Tool Compatibility");
		assert.notEqual(compatibilityIndex, -1, `${skillName} is missing Codex compatibility guidance`);
		assert.ok(
			compatibilityIndex < content.search(opencodeOnlyToolPattern),
			`${skillName} must explain Codex tool translation before OpenCode-only examples`,
		);
	}
});
