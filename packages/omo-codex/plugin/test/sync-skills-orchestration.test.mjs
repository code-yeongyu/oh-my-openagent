import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { codexHarnessToolCompatibility, insertCodexCompatibilityGuidance } from "../scripts/sync-skills.mjs";

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

async function readSharedSkill(skillName) {
	return readFile(join(root, "../../shared-skills/skills", skillName, "SKILL.md"), "utf8");
}

function patternFromParts(parts, flags) {
	return new RegExp(parts.join(""), flags);
}

const multiAgentV2RoleGuidance =
	"If instead a flat `spawn_agent` with a required `task_name` exists (`multi_agent_v2`), rewrite every `multi_agent_v1.*` example:";
const loadSkillsGuidance =
	"When translating `load_skills=[...]`, include the requested skill names in the spawned agent's `message`.";

test("#given synced aggregate Codex skills #when they contain OpenCode orchestration examples #then Codex tool compatibility guidance is injected", async () => {
	// given
	const opencodeOnlyToolPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/;

	// when / then
	for (const skillName of await listSkillNames()) {
		const content = await readSkill(skillName);
		if (!opencodeOnlyToolPattern.test(content)) continue;

		const compatibilityMatches = content.match(/## Codex Harness Tool Compatibility/g) ?? [];
		const compatibilityIndex = content.indexOf("## Codex Harness Tool Compatibility");
		assert.notEqual(compatibilityIndex, -1, `${skillName} is missing Codex compatibility guidance`);
		assert.equal(compatibilityMatches.length, 1, `${skillName} must not duplicate Codex compatibility guidance`);
		assert.ok(
			compatibilityIndex < content.search(opencodeOnlyToolPattern),
			`${skillName} must explain Codex tool translation before OpenCode-only examples`,
		);
		assert.ok(content.includes(multiAgentV2RoleGuidance), `${skillName} missing multi_agent_v2 role guidance`);
		assert.ok(content.includes(loadSkillsGuidance), `${skillName} missing load_skills guidance`);
	}
});

test("#given late variant Codex compatibility guidance #when adapting a skill #then it is moved without duplication", () => {
	// given
	const content = `---
name: example
---

# Example Skill

call_omo_agent(subagent_type="explore", prompt="inspect")

## Codex Harness Tool Compatibility

Older variant guidance.

When translating \`load_skills=[...]\`, name the skills inside the spawned agent's \`message\`. If a code block below conflicts with this section, this section wins.

---

## Next Section

task(category="quick", prompt="verify")
`;

	// when
	const adapted = insertCodexCompatibilityGuidance(content);

	// then
	const compatibilityIndex = adapted.indexOf("## Codex Harness Tool Compatibility");
	const firstToolIndex = adapted.search(/\b(?:call_omo_agent|task)\s*\(/);
	assert.notEqual(compatibilityIndex, -1);
	assert.ok(compatibilityIndex < firstToolIndex);
	assert.equal(adapted.match(/## Codex Harness Tool Compatibility/g)?.length, 1);
	assert.doesNotMatch(adapted, /Older variant guidance/);
	assert.doesNotMatch(adapted, /name the skills inside the spawned agent's `message`/);
	assert.match(adapted, /\n---\n\n## Next Section/);
});

test("#given early custom Codex compatibility guidance #when adapting a skill #then it is preserved exactly", () => {
	// given
	const content = `---
name: example
---

## Codex Harness Tool Compatibility

Custom guidance for this skill, including \`dispatchInternalPrompt(...)\`.

# Example Skill

call_omo_agent(subagent_type="explore", prompt="inspect")
`;

	// when
	const adapted = insertCodexCompatibilityGuidance(content);

	// then
	assert.equal(adapted, content);
});

test("#given early generated stale Codex compatibility guidance #when adapting a skill #then it is replaced", () => {
	// given
	const content = `---
name: example
---

## Codex Harness Tool Compatibility

This skill may include examples copied from the OpenCode harness. In Codex, do not call OpenCode-only tools such as \`call_omo_agent(...)\`, \`task(...)\`, \`background_output(...)\`, or \`team_*(...)\` literally. Translate those examples to Codex native tools:

| OpenCode example | Codex tool to use |
| --- | --- |
| \`call_omo_agent(subagent_type="explore", ...)\` | \`spawn_agent({"task_name":"...","message":"TASK: act as an explorer. ..."})\` |
| \`background_output(task_id="...")\` | \`wait_agent(...)\` for mailbox signals |

Obsolete generated compatibility prose.

More obsolete generated compatibility prose.

When translating \`load_skills=[...]\`, include the requested skill names in the spawned agent's \`message\`. If a code block below conflicts with this section, this section wins.

# Example Skill

call_omo_agent(subagent_type="explore", prompt="inspect")
`;

	// when
	const adapted = insertCodexCompatibilityGuidance(content);

	// then
	assert.match(adapted, /multi_agent_v1\.spawn_agent/);
	assert.match(adapted, /fork_context":false/);
	assert.match(adapted, /"agent_type":"explorer"/);
	assert.match(adapted, /multi_agent_v1\.wait_agent/);
	assert.match(adapted, /"task_name":"<lowercase_digits_underscores>"/);
	assert.match(adapted, /fork_turns/);
	assert.doesNotMatch(adapted, /\| `spawn_agent\({"task_name"/);
	assert.doesNotMatch(adapted, /Obsolete generated compatibility prose/);
});

test("#given generated Codex compatibility guidance #when adapting a skill #then multi-agent role and load_skills guidance are both present", () => {
	// given
	const content = `---
name: example
---

# Example Skill

task(subagent_type="oracle", load_skills=["debugging"], prompt="verify")
`;

	// when
	const adapted = insertCodexCompatibilityGuidance(content);

	// then
	assert.ok(adapted.includes(multiAgentV2RoleGuidance));
	assert.ok(adapted.includes(loadSkillsGuidance));
});

test("#given generated guidance before a template export #when adapting a skill #then the export wrapper is preserved", () => {
	// given
	const content = `---
name: refactor
---

## Codex Harness Tool Compatibility

Older variant guidance.

When translating \`load_skills=[...]\`, name the skills inside the spawned agent's \`message\`. If a code block below conflicts with this section, this section wins.

export const REFACTOR_TEMPLATE = \`# Refactor

call_omo_agent(subagent_type="explore", prompt="inspect")
\`
`;

	// when
	const adapted = insertCodexCompatibilityGuidance(content);

	// then
	assert.match(adapted, /export const REFACTOR_TEMPLATE = `# Refactor/);
	assert.match(adapted, /multi_agent_v1\.spawn_agent/);
	assert.doesNotMatch(adapted, /Older variant guidance/);
});

test("#given synced aggregate Codex skills #when they describe background orchestration #then liveness is framed as progress rather than timeout failure", async () => {
	// given
	const orchestrationPattern = /\b(?:run_in_background|background_output|wait_agent)\b/;
	const requiredPatterns = [
		["working progress message", /WORKING:/],
		["blocked progress message", /BLOCKED:/],
		["mailbox timeout framing", /timeout only means no new mailbox update arrived/],
		// Skills route by session tool surface: the namespaced V1 tool or the flat V2 tool both count.
		["wait-agent tool ref", /multi_agent_v1\.wait_agent|`wait_agent`/],
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

test("#given start-work skill #when synced for Codex #then the difficulty-tier delegation guidance survives the overlay", async () => {
	const content = await readSkill("start-work");

	assert.match(content, /lazycodex-worker-medium/);
	assert.match(content, /Delegation by difficulty/);
	assert.match(content, /Global Review and Debugging Gate/);
	assert.match(content, /full commit SHA/);
	assert.match(content, /re-read the ledger record/);
	assert.match(content, /exact lane\/SHA pair/);
	assert.doesNotMatch(content, /works the same on both surfaces/);
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
	assert.match(content, /bare REJECT\/FAIL token without findings is not a verdict/);
	assert.match(content, /cites the violated goal criterion/);
	assert.match(content, /append a durable task-evidence record/);
	assert.match(content, /full commit SHA/);
	assert.match(content, /re-read that record/);
	assert.match(content, /exact lane\/SHA pair/);
	assert.match(content, /Do not use `multi_agent_v1\.send_input` as an interrupt/);
});

test("#given PR and review skills #when synced for Codex #then worktree lifecycle is mandatory", async () => {
	const startWork = await readSkill("start-work");
	const reviewWork = await readSkill("review-work");
	const sharedStartWork = await readSharedSkill("start-work");

	assert.match(startWork, /PR creation, PR handoff, branch handoff, or merge/);
	assert.match(startWork, /Finish the PR\/branch lifecycle from its task-owned worktree/);
	assert.match(startWork, /merge by default unless explicitly opted out/);
	assert.match(startWork, /No PR\/branch implementation or review in the main worktree/);

	assert.match(sharedStartWork, /required for PR\/branch work/);
	assert.match(sharedStartWork, /No PR\/branch implementation, review, or merge in the main worktree/);
	assert.doesNotMatch(sharedStartWork, /If worktree mode was used/);
	assert.doesNotMatch(sharedStartWork, /merge or hand off exactly as requested/);

	assert.match(reviewWork, /dedicated review worktree attached to that branch/);
	assert.match(reviewWork, /Never\s+checkout, test, or edit the review branch in the main worktree/);
});

test("#given generated Codex compatibility guidance #when multi-agent lifecycle tools are mentioned #then optional tools are guarded by the active tools list", () => {
	assert.match(codexHarnessToolCompatibility, /when exposed in the active tools list/, "send_input/close_agent must be marked optional (lazycodex#116)");
	assert.match(codexHarnessToolCompatibility, /multi_agent_v1\.spawn_agent/);
	assert.match(codexHarnessToolCompatibility, /multi_agent_v1\.wait_agent/);
});
