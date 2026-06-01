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
			!/wait_agent.*signal, not proof/s.test(text) ||
			!/one targeted followup/.test(text) ||
			!/respawn.*smaller/s.test(text) ||
			!/model.*reasoning_effort.*default agent/s.test(text) ||
			!/Plan and reviewer agents may run for a long time/.test(text) ||
			!/short wait_agent cycles/.test(text) ||
			!/single long blocking wait/.test(text)
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
	assert.match(text, /codex-ultrawork-reviewer/);
	assert.match(text, /agent_type.*worker/s);
	assert.match(text, /model.*reasoning_effort.*default agent/s);
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
