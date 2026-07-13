import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CONTEXT_PRESSURE_SKILL_BUDGET_BYTES } from "./sync-skills-test-support.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("#given synced ulw-loop skill #when Codex hint metadata is inspected #then ulw-loop surfaces the ulw-loop alias", async () => {
	// given
	const skillRoot = join(root, "skills", "ulw-loop");

	// when
	const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const interfaceMetadata = await readFile(
		join(skillRoot, "agents", "openai.yaml"),
		"utf8",
	);

	// then
	assert.match(skill, /^---\r?\nname: ulw-loop\r?\n/m);
	assert.match(interfaceMetadata, /display_name: "\(OmO\) ulw-loop"/);
	assert.doesNotMatch(interfaceMetadata, /ulw-loop \/ ulw-loop/);
	assert.match(
		interfaceMetadata,
		/short_description: "Goal-like ultrawork loop for systematic decomposition"/,
	);
	assert.match(interfaceMetadata, /default_prompt: "Use \$ulw-loop/);
});

test("#given synced ulw-loop skill #when Codex hint metadata is inspected #then ulw-loop remains discoverable as an alias", async () => {
	// given
	const skillRoot = join(root, "skills", "ulw-loop");

	// when
	const interfaceMetadata = await readFile(
		join(skillRoot, "agents", "openai.yaml"),
		"utf8",
	);

	// then
	assert.match(interfaceMetadata, /search_terms:/);
	assert.match(interfaceMetadata, /- "ulw-loop"/);
});

test("#given synced git-master skill #when inspected #then commits and git history route through it", async () => {
	// given
	const skillRoot = join(root, "skills", "git-master");

	// when
	const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const interfaceMetadata = await readFile(
		join(skillRoot, "agents", "openai.yaml"),
		"utf8",
	);

	// then
	assert.match(skill, /^---\r?\nname: git-master\r?\n/m);
	assert.match(
		skill,
		/MUST USE whenever a task needs a commit or git-history investigation/,
	);
	assert.match(skill, /Commit only the user's requested changes/);
	assert.match(skill, /Choose the Git tool by the question/);
	assert.match(skill, /git log -S "text"/);
	assert.match(skill, /git blame -L start,end -- file/);
	assert.match(interfaceMetadata, /display_name: "\(OmO\) git-master"/);
	assert.match(interfaceMetadata, /- "git commit"/);
	assert.match(interfaceMetadata, /- "history search"/);
});

test("#given synced ulw-loop skill #when worker guidance is inspected #then context-hygiene guidance matches the source", async () => {
	// given
	const sourceSkill = await readFile(
		join(
			root,
			"components",
			"ulw-loop",
			"skills",
			"ulw-loop",
			"references",
			"full-workflow.md",
		),
		"utf8",
	);
	const syncedSkill = await readFile(
		join(root, "skills", "ulw-loop", "SKILL.md"),
		"utf8",
	);
	const syncedWorkflow = await readFile(
		join(root, "skills", "ulw-loop", "references", "full-workflow.md"),
		"utf8",
	);
	// ulw-loop is V2-primary (gpt-5.6 sol/terra use `agents.wait_agent`); the `multi_agent_v1.*`
	// namespace is documented only as the v1 fallback, so the wait_agent refs accept the bare token.
	const requiredPatterns = [
		["wait_agent ref", /\bwait_agent\b/],
		["local spawned-name tracking", /Track spawned agent names locally/],
		["wait_agent mailbox path", /wait_agent.*mailbox signals/],
		["progress status contract", /WORKING:/],
		[
			"long-running plan/reviewer background guidance",
			/Plan and reviewer agents may run for a long time/,
		],
		["bounded plan/reviewer polling", /wait_agent.*cycles/],
		["exponential backoff wait guard", /double the timeout up to ~5 minutes/],
		["git-master checkpointing", /git-master/],
		["touched-path commit-style probe", /touched-path commit history/],
		["verified work-unit commit", /verified work unit/],
		["observed commit style", /commit in the observed style/],
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
		const content = await readFile(
			join(skillsRoot, skillName, "SKILL.md"),
			"utf8",
		);
		totalBytes += Buffer.byteLength(content, "utf8");
	}

	// then
	assert.ok(
		totalBytes <= CONTEXT_PRESSURE_SKILL_BUDGET_BYTES,
		`debugging + ulw-loop eager payload is ${totalBytes} bytes, above ${CONTEXT_PRESSURE_SKILL_BUDGET_BYTES}`,
	);
});
