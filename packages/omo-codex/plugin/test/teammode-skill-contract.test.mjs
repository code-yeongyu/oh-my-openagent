import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const requiredContracts = [
	["frontmatter name", /^---\r?\nname: teammode\r?\n/m],
	["Codex-only scope", /Codex-only/i],
	["team state root", /\.omo\/teams\/\{session_id\}/],
	["leader state field", /"leader"/],
	["members state field", /"members"/],
	["active team state field", /"activeTeam"/],
	["team name state field", /"teamName"/],
	["archived state field", /"archived"/],
	["member threads state field", /"threadId"/],
	["team thread title format", /\[team name\] \{session name\}/i],
	["English-only member communication", /English-only|English only/i],
	["frequent status updates", /frequent/i],
	["clear member roles", /clear role|explicit role/i],
	["team thread creation", /codex_app\.create_thread/],
	["thread message broadcast", /codex_app\.send_message_to_thread/],
	["thread status inspection", /codex_app\.read_thread/],
	["thread title update", /codex_app\.set_thread_title/],
	["thread archival", /codex_app\.set_thread_archived/],
	["native subagent fallback", /multi_agent_v1\.spawn_agent/],
	["native subagent waiting", /multi_agent_v1\.wait_agent/],
	["native subagent cleanup", /multi_agent_v1\.close_agent/],
	["archive closes members", /archive[\s\S]*member[\s\S]*(?:close|archive)/i],
	["delete removes team state", /delete[\s\S]*\.omo\/teams\/\{session_id\}/i],
	["upstream inspiration is attributed", /inspired\s+by[\s\S]*oh-my-codex/i],
];

const bannedRuntimePatterns = [
	["OMX command runtime", /\bomx\s+team\b/i],
	["OMX team state", /\.omx\/state\/team/i],
	["generic OMX runtime", /\bOMX\b/],
	["OpenCode team tool create", /team_create\(/],
	["OpenCode team tool send", /team_send_message\(/],
	["OpenCode team tool delete", /team_delete\(/],
	["tmux runtime", /\btmux\b/i],
	["pane runtime", /\bpane\b/i],
];

async function readSkill(path) {
	return readFile(path, "utf8");
}

function assertTeamModeContract(content, label) {
	for (const [name, pattern] of requiredContracts) {
		assert.match(content, pattern, `${label} missing contract: ${name}`);
	}
	for (const [name, pattern] of bannedRuntimePatterns) {
		assert.doesNotMatch(content, pattern, `${label} leaked banned runtime: ${name}`);
	}
}

test("#given Codex teammode source skill #when inspected #then it defines the native team contract", async () => {
	const content = await readSkill(join(root, "components", "teammode", "skills", "teammode", "SKILL.md"));

	assertTeamModeContract(content, "source teammode skill");
});

test("#given generated Codex teammode skill #when inspected #then it preserves the team contract and metadata", async () => {
	const skillRoot = join(root, "skills", "teammode");
	const content = await readSkill(join(skillRoot, "SKILL.md"));
	const metadata = await readSkill(join(skillRoot, "agents", "openai.yaml"));

	assertTeamModeContract(content, "generated teammode skill");
	assert.match(metadata, /display_name: "\(OmO\) teammode"/);
});
