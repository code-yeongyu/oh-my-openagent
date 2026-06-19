import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// The v2 skill drives a bundled state script: the team.json/guide shapes are pinned by the
// script tests (teammode-state.test.mjs / teammode-cli.test.mjs). This contract pins the
// SKILL.md SURFACE - the leader-facing protocol the model reads - plus the banned runtime.
const requiredContracts = [
	["frontmatter name", /^---\r?\nname: teammode\r?\n/m],
	["Codex-only scope", /Codex-only/i],
	["team state root", /\.omo\/teams\/\{session_id\}/],
	["main session is the leader", /main session[\s\S]{0,40}leader|leader[\s\S]{0,40}main session/i],
	["compose by ownership", /ownership/i],
	["compose by perspective", /perspective/i],
	["vague role is an anti-pattern", /vague role[\s\S]*anti-pattern|anti-pattern[\s\S]*vague role/i],
	["when to use a team guidance", /when to use a team/i],
	["subagent alternative", /subagent/i],
	["a team is always two or more members", /two or more members/i],
	["single-member team is rejected", /single-member team/i],
	["clear non-overlapping responsibility per aspect", /responsibilit[\s\S]{0,40}aspect|aspect[\s\S]{0,40}responsibilit/i],
	["disband the team when no longer needed", /disband/i],
	["runs the bundled state script", /team\.mjs/],
	["script path is skill-relative", /<skill-root>/],
	["team thread title format", /\[team name\] \{session name\}/i],
	["English-only member communication", /English-only|English only|communication is in English/i],
	["replies to the user in the user's language", /user'?s own language|user'?s language/i],
	["finished member reports to the leader", /report[\s\S]{0,60}leader/i],
	["stale or blocked is not acceptable", /stale[\s\S]{0,80}not\s+acceptable/i],
	["frequent status updates", /WORKING:/],
	["artifacts exchange space", /artifacts/i],
	["worktree concept", /worktree/i],
	["generated member field manual", /guide\.md/],
	["team thread creation", /codex_app\.create_thread/],
	["thread message broadcast", /codex_app\.send_message_to_thread/],
	["thread status inspection", /codex_app\.read_thread/],
	["thread title update", /codex_app\.set_thread_title/],
	["thread archival", /codex_app\.set_thread_archived/],
	["native subagent helper lane", /multi_agent_v1\.spawn_agent/],
	["native subagent waiting", /multi_agent_v1\.wait_agent/],
	["native subagent cleanup", /multi_agent_v1\.close_agent/],
	["archive closes members", /archive[\s\S]*member[\s\S]*(?:close|archive)/i],
	["delete removes team state", /delete[\s\S]*\.omo\/teams\/\{session_id\}/i],
	["worktree integration respects the user", /merge[\s\S]*PR|PR[\s\S]*merge/i],
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

function assertTeamModeContract(content, label) {
	for (const [name, pattern] of requiredContracts) {
		assert.match(content, pattern, `${label} missing contract: ${name}`);
	}
	for (const [name, pattern] of bannedRuntimePatterns) {
		assert.doesNotMatch(content, pattern, `${label} leaked banned runtime: ${name}`);
	}
}

test("#given Codex teammode source skill #when inspected #then it defines the script-driven team contract", async () => {
	const content = await readFile(join(root, "components", "teammode", "skills", "teammode", "SKILL.md"), "utf8");

	assertTeamModeContract(content, "source teammode skill");
});

test("#given generated Codex teammode skill #when inspected #then it preserves the team contract, the script, and metadata", async () => {
	const skillRoot = join(root, "skills", "teammode");
	const content = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const metadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	assertTeamModeContract(content, "generated teammode skill");
	assert.match(metadata, /display_name: "\(OmO\) teammode"/);
});

test("#given the generated teammode skill #when its scripts are inspected #then the bundled controller and state model ship with it", async () => {
	const scriptsRoot = join(root, "skills", "teammode", "scripts");

	for (const file of ["team.mjs", "team-state.mjs", "team-guide.mjs"]) {
		const content = await readFile(join(scriptsRoot, file), "utf8");
		assert.ok(content.length > 0, `generated teammode skill is missing bundled script: ${file}`);
	}
});
