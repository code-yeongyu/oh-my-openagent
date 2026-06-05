import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function listSkillNames() {
	const skillsRoot = join(root, "skills");
	const entries = await readdir(skillsRoot, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

async function readSkill(skillName) {
	return readFile(join(root, "skills", skillName, "SKILL.md"), "utf8");
}

function patternFromParts(parts, flags) {
	return new RegExp(parts.join(""), flags);
}

test("#given synced aggregate Codex skills #when they contain OpenCode orchestration examples #then Codex tool compatibility guidance is injected", async () => {
	// given
	const opencodeOnlyToolPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/;

	// when / then
	for (const skillName of await listSkillNames()) {
		const content = await readSkill(skillName);
		if (!opencodeOnlyToolPattern.test(content)) continue;

		const compatibilityIndex = content.indexOf("## Codex Harness Tool Compatibility");
		assert.notEqual(compatibilityIndex, -1, `${skillName} is missing Codex compatibility guidance`);
		assert.ok(
			compatibilityIndex < content.search(opencodeOnlyToolPattern),
			`${skillName} must explain Codex tool translation before OpenCode-only examples`,
		);
	}
});

test("#given synced aggregate Codex skills #when they describe background orchestration #then liveness is framed as progress rather than timeout failure", async () => {
	// given
	const orchestrationPattern = /\b(?:run_in_background|background_output|wait_agent)\b/;
	const requiredPatterns = [
		["working progress message", /WORKING:/],
		["blocked progress message", /BLOCKED:/],
		["mailbox timeout framing", /timeout only means no new mailbox update arrived/],
		["single liveness check", /single `list_agents` check|one `list_agents` check/],
		["polling-loop guard", /Do not use `list_agents` as a polling loop|Do NOT use `list_agents` as a polling loop/],
		["explicit fallback conditions", /Fallback only when|Mark a file for retry only when/],
	];
	const bannedPatterns = [
		["timeout as failure", patternFromParts(["fails or ", "times out"], "i")],
		["failed or timed out", patternFromParts(["failed or ", "timed out"], "i")],
		["two waits heuristic", patternFromParts(["After two ", "waits"])],
		["unresponsive timeout framing", patternFromParts(["timeout", ".*", "un" + "responsive"], "i")],
		["old status-tool warning", patternFromParts(["polling or ", "status tool"])],
		["large status replay wording", patternFromParts(["large agent status", " and latest-message"])],
		["old wait-agent aphorism", patternFromParts(["wait_agent", ".*", "signal, not ", "proof"], "i")],
	];

	// when / then
	for (const skillName of await listSkillNames()) {
		const content = await readSkill(skillName);
		if (!orchestrationPattern.test(content)) continue;

		for (const [label, pattern] of requiredPatterns) {
			assert.match(content, pattern, `${skillName} missing ${label}`);
		}
		for (const [label, pattern] of bannedPatterns) {
			assert.doesNotMatch(content, pattern, `${skillName} still has ${label}`);
		}
	}
});

test("#given review-work skill #when some lanes do not finish #then aggregate result remains bounded", async () => {
	const content = await readSkill("review-work");

	assert.match(content, /pending\/PASS\/FAIL\/INCONCLUSIVE/);
	assert.match(content, /Preserve completed lane results immediately/);
	assert.match(content, /ALL 5 lanes have a terminal state/);
	assert.match(content, /REVIEW INCONCLUSIVE - not approved/);
	assert.match(content, /Overall Verdict: PASSED \/ FAILED \/ INCONCLUSIVE/);
	assert.match(content, /PASS\/FAIL\/INCONCLUSIVE \| HIGH\/MED\/LOW/);
	assert.match(content, /Do not spin in repeated/);
	assert.match(content, /Do not use `send_message` as an interrupt/);
});
