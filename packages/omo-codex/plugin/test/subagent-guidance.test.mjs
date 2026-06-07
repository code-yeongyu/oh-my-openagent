import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const SKILLS = [
	"review-work",
	"start-work",
	"ulw-loop",
	"ulw-plan",
];

const AGENT_FILES = [
	"components/ultrawork/agents/codex-ultrawork-reviewer.toml",
	"components/ultrawork/agents/plan.toml",
];

test("#given orchestration skills #when inspected #then Codex subagent delegation is hardened", async () => {
	// given
	const skillPaths = SKILLS.map((skillName) => join("skills", skillName, "SKILL.md"));

	// when
	const missing = [];
	for (const skillPath of skillPaths) {
		const text = await readFile(join(root, skillPath), "utf8");
		if (
			!/TASK:/.test(text) ||
			!/fork_turns:\s*"none"/.test(text) ||
			!/wait_agent.*mailbox signals/s.test(text) ||
			!/Fallback only when/.test(text) ||
			!/respawn.*smaller/s.test(text) ||
			!/schema only accepts `task_name`, `message`, and `fork_turns`/s.test(text) ||
			!/Plan and reviewer agents may run for a long time/.test(text) ||
			!/short wait_agent cycles/.test(text) ||
			!/single long blocking wait/.test(text) ||
			!/A timeout only means no new mailbox update arrived/i.test(text) ||
			!/WORKING:/.test(text) ||
			!/single `list_agents`/.test(text)
		) {
			missing.push(skillPath);
		}
	}

	// then
	assert.deepEqual(missing, []);
});

test("#given ultrawork directive #when inspected #then reviewer fallback keeps an agent role", async () => {
	// given
	const directivePath = "components/ultrawork/directive.md";

	// when
	const text = await readFile(join(root, directivePath), "utf8");

	// then
	assert.doesNotMatch(text, /any `gpt-5\.2`\s+xhigh reviewer/);
	assert.match(text, /self-contained reviewer/);
	assert.match(text, /schema cannot select.*TOML-backed reviewer role/s);
	assert.match(text, /paste the reviewer requirements into\s+the message/s);
	assert.match(text, /timeout only means no new mailbox update arrived/i);
	assert.match(text, /WORKING:/);
	assert.match(text, /single `list_agents`/);
});

test("#given ultrawork directive #when inspected #then dependent subagent transitions are blocked", async () => {
	// given
	const directivePath = "components/ultrawork/directive.md";

	// when
	const text = await readFile(join(root, directivePath), "utf8");

	// then
	assert.match(text, /Subagent-dependent transition barrier/);
	assert.match(text, /Do not mark.*update_plan.*completed.*active child/s);
	assert.match(text, /Do not start dependent implementation.*audit.*research.*review.*integrated/s);
	assert.match(text, /Do not write the final answer.*active child agents/s);
	assert.match(text, /two silent waits.*TASK STILL ACTIVE/s);
	assert.match(text, /four silent or ack-only checks.*inconclusive/s);
});

test("#given ultrawork directive #when inspected #then TOML-backed routing is treated as unverified when native spawn cannot select it", async () => {
	// given
	const directivePath = "components/ultrawork/directive.md";

	// when
	const text = await readFile(join(root, directivePath), "utf8");

	// then
	assert.match(text, /TOML-backed subagent routing compatibility/);
	assert.match(text, /routing-unverified/);
	assert.match(text, /schema accepts only `task_name`, `message`, and\s+`fork_turns`/s);
	assert.match(text, /cannot select a TOML-backed role, model, reasoning\s+effort, or `service_tier`/s);
	assert.match(text, /paste the\s+role requirements into the message/s);
});

test("#given ulw-loop workflow #when inspected #then stale review refresh keeps policy changes narrow", async () => {
	// given
	const workflowPaths = [
		"components/ulw-loop/skills/ulw-loop/references/full-workflow.md",
		"skills/ulw-loop/references/full-workflow.md",
	];

	// when
	const missing = [];
	for (const workflowPath of workflowPaths) {
		const text = await readFile(join(root, workflowPath), "utf8");
		if (
			!/refresh current branch\/PR\/issue state/.test(text) ||
			!/preserve existing ordering\/policy/.test(text) ||
			!/separate compatibility detection from policy changes/.test(text)
		) {
			missing.push(workflowPath);
		}
	}

	// then
	assert.deepEqual(missing, []);
});

test("#given ultrawork agents #when inspected #then inter-agent commentary is treated as assignments", async () => {
	// given
	const agentPaths = AGENT_FILES;

	// when
	const missing = [];
	for (const agentPath of agentPaths) {
		const text = await readFile(join(root, agentPath), "utf8");
		if (!/TASK:|active review assignment/.test(text) || !/context|commentary/.test(text)) {
			missing.push(agentPath);
		}
	}

	// then
	assert.deepEqual(missing, []);
});

test("#given reviewer receives a targeted still-active followup #when prompt is inspected #then it must fail loud", async () => {
	// given
	const reviewerPath = "components/ultrawork/agents/codex-ultrawork-reviewer.toml";

	// when
	const text = await readFile(join(root, reviewerPath), "utf8");

	// then
	assert.match(text, /TASK STILL ACTIVE:/);
	assert.match(text, /BLOCKED: <reason>/);
	assert.match(text, /instead of continuing silently/);
});
