#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sharedSkillsRoot = sharedSkillsRootPath();
const skillsRoot = join(root, "skills");
const sourceTestFilePattern = /\.test\.ts$/;
const skillSources = [
	["comment-checker", "components/comment-checker/skills/comment-checker"],
	["lsp", "components/lsp/skills/lsp"],
	["rules", "components/rules/skills/rules"],
	["ulw-loop", "components/ulw-loop/skills/ulw-loop"],
	["ulw-plan", "components/ultrawork/skills/ulw-plan"],
];

const opencodeOnlyOrchestrationPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/;

const codexHarnessToolCompatibility = `## Codex Harness Tool Compatibility

This skill may include examples copied from the OpenCode harness. In Codex, do not call OpenCode-only tools such as \`call_omo_agent(...)\`, \`task(...)\`, \`background_output(...)\`, or \`team_*(...)\` literally. Translate those examples to Codex native tools:

| OpenCode example | Codex tool to use |
| --- | --- |
| \`call_omo_agent(subagent_type="explore", ...)\` | \`spawn_agent({"task_name":"...","message":"TASK: act as an explorer. ...","fork_turns":"none"})\` |
| \`call_omo_agent(subagent_type="librarian", ...)\` | \`spawn_agent({"task_name":"...","message":"TASK: act as a librarian. ...","fork_turns":"none"})\` |
| \`task(subagent_type="plan", ...)\` | \`spawn_agent({"task_name":"...","message":"TASK: act as a planning agent. ...","fork_turns":"none"})\` |
| \`task(subagent_type="oracle", ...)\` for final verification | \`spawn_agent({"task_name":"...","message":"TASK: act as a rigorous reviewer. ...","fork_turns":"none"})\` |
| \`task(category="...", ...)\` for implementation or QA | \`spawn_agent({"task_name":"...","message":"TASK: act as an implementation or QA worker. ...","fork_turns":"none"})\` |
| \`background_output(task_id="...")\` | \`wait_agent(...)\` for mailbox signals; after a timeout, run one \`list_agents\` check for the named child if reassurance is needed |
| \`team_*(...)\` | Use Codex native subagents plus \`send_message\`, \`followup_task\`, \`wait_agent\`, and \`close_agent\` |

Codex full-history forks inherit parent context, so role-specific behavior must be described in a self-contained \`message\` and usually should use a non-full-history fork mode such as \`fork_turns="none"\`. Include any required conversation context, files, diffs, constraints, and requested skill names directly in the spawned agent's \`message\`. If a code block below conflicts with this section, this section wins.

For work likely to exceed one wait cycle, require the child to send \`WORKING: <task> - <current phase>\` before long passes and \`BLOCKED: <reason>\` only when progress stops. A \`wait_agent\` timeout only means no new mailbox update arrived. Treat a running child or latest \`WORKING:\` message as alive. Do not use \`list_agents\` as a polling loop. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly \`BLOCKED:\`, or no longer running.

`;

const codexCompatibilityEndMarkers = [
	"For work likely to exceed one wait cycle, require the child to send `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. A `wait_agent` timeout only means no new mailbox update arrived. Treat a running child or latest `WORKING:` message as alive. Do not use `list_agents` as a polling loop. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running.\n\n",
	"Codex full-history forks inherit parent context, so role-specific behavior must be described in a self-contained `message` and usually should use a non-full-history fork mode such as `fork_turns=\"none\"`. Include any required conversation context, files, diffs, constraints, and requested skill names directly in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
	"When translating `load_skills=[...]`, include the requested skill names in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
	"When translating `load_skills=[...]`, name the skills inside the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
];

function findCodexCompatibilitySectionEnd(content, searchStart) {
	const structuralEndPattern = /\n(?:---|#{1,6}\s)/g;
	structuralEndPattern.lastIndex = searchStart;
	const structuralEnd = structuralEndPattern.exec(content);
	if (structuralEnd) return structuralEnd.index + 1;

	const knownEndMarker = codexCompatibilityEndMarkers.find((marker) => content.indexOf(marker, searchStart) !== -1);
	if (knownEndMarker === undefined) return content.length;

	return content.indexOf(knownEndMarker, searchStart) + knownEndMarker.length;
}

function removeCodexCompatibilityGuidance(content) {
	const heading = "## Codex Harness Tool Compatibility";
	let withoutGuidance = content;

	while (true) {
		const start = withoutGuidance.indexOf(heading);
		if (start === -1) return withoutGuidance;

		const end = findCodexCompatibilitySectionEnd(withoutGuidance, start + heading.length);

		withoutGuidance = `${withoutGuidance.slice(0, start)}${withoutGuidance.slice(end)}`;
	}
}

export function insertCodexCompatibilityGuidance(content) {
	if (!opencodeOnlyOrchestrationPattern.test(content)) return content;
	const firstExampleIndex = content.search(opencodeOnlyOrchestrationPattern);
	const compatibilityIndex = content.indexOf("## Codex Harness Tool Compatibility");
	if (compatibilityIndex !== -1 && compatibilityIndex < firstExampleIndex) return content;

	const contentWithoutGuidance = removeCodexCompatibilityGuidance(content);

	const frontmatterMatch = contentWithoutGuidance.match(/^---\n[\s\S]*?\n---\n+/);
	if (!frontmatterMatch) {
		return `${codexHarnessToolCompatibility}${contentWithoutGuidance}`;
	}

	return `${frontmatterMatch[0]}${codexHarnessToolCompatibility}${contentWithoutGuidance.slice(frontmatterMatch[0].length)}`;
}

const startWorkOriginalCompletion = `When all top-level checkboxes in \`## TODOs\` and \`## Final Verification Wave\` are complete:

1. Run the plan's final verification commands.
2. If worktree mode was used, sync \`.omo/\` state back to the main repo, merge or hand off exactly as requested, and remove the worktree only after successful merge or explicit handoff.
3. Remove or mark the Boulder work as completed.
4. Print an \`ORCHESTRATION COMPLETE\` block with the plan path, verification commands, artifacts, and cleanup receipts.`;

const startWorkCodexCompletion = `When all top-level checkboxes in \`## TODOs\` and \`## Final Verification Wave\` are complete:

1. Run the plan's final verification commands.
2. Complete the **Global Review and Debugging Gate** before any completion claim, PR handoff, or branch handoff:
   - Invoke the \`review-work\` skill with the final diff, changed files, user goal, constraints, run command, and verification evidence. All five review lanes must return PASS. A timeout, missing deliverable, ack-only child, \`BLOCKED:\`, or inconclusive lane is a gate failure, not approval.
   - Run a debugging-oriented runtime audit even when the review passes: name at least three plausible failure hypotheses for the changed surface, run the distinguishing checks against the actual artifact, and append the ruled-out or confirmed result to \`.omo/start-work/ledger.jsonl\`.
   - If any review lane or debugging hypothesis fails, invoke the \`debugging\` skill, confirm root cause with runtime evidence, add the minimal failing test or reproduction, fix it, rerun the affected verification, then rerun the Global Review and Debugging Gate.
   - Evidence hygiene is mandatory: redact or mask secrets and sensitive user data before writing \`.omo/start-work/ledger.jsonl\`, a PR body, or a handoff. Never include raw tokens, credentials, auth headers, cookies, API keys, env dumps, private logs, or PII; use concise summaries, lengths, hashes, or short non-sensitive prefixes instead.
   - If the work includes creating, updating, or handing off a PR, refresh \`git status\` and the PR/branch state after the gate, and include only redacted review/debugging evidence in the PR body or handoff.
3. If worktree mode was used, sync \`.omo/\` state back to the main repo, merge or hand off exactly as requested, and remove the worktree only after successful merge or explicit handoff.
4. Remove or mark the Boulder work as completed.
5. Print an \`ORCHESTRATION COMPLETE\` block with the plan path, verification commands, Global Review and Debugging Gate verdict, artifacts, and cleanup receipts.`;

const startWorkOriginalHardRule = "- No completion claim while an applicable ultraqa adversarial class was never probed. Each applicable class needs a captured observable result; each skipped class needs a one-line not-applicable reason in the ledger.\n- No unprefixed session ids in Boulder state. Codex sessions are always `codex:<session_id>`.";

const startWorkCodexHardRule = "- No completion claim while an applicable ultraqa adversarial class was never probed. Each applicable class needs a captured observable result; each skipped class needs a one-line not-applicable reason in the ledger.\n- No `ORCHESTRATION COMPLETE`, final response, PR creation, or PR handoff before the Global Review and Debugging Gate passes with recorded evidence.\n- No unprefixed session ids in Boulder state. Codex sessions are always `codex:<session_id>`.";

const reviewWorkAnchor = "Launch 5 specialized sub-agents in parallel to review completed implementation work from every angle. All 5 must pass for the review to pass. If even ONE fails, the review fails.\n";

const reviewWorkCodexGate = `
When \`review-work\` is used as a final implementation, PR, or \`$start-work\`
gate, it is blocking. A timeout, missing deliverable, ack-only response,
explicit \`BLOCKED:\`, or inconclusive lane is not a pass. Treat that lane as
failed, investigate the underlying uncertainty with the \`debugging\` skill when
runtime behavior may be wrong, fix with evidence, and rerun the affected lane
before claiming completion or handing off a PR.

Review evidence must be safe to share. Redact or mask secrets and sensitive
user data before including evidence in logs, PR bodies, or handoffs. Never
include raw tokens, credentials, auth headers, cookies, API keys, env dumps,
private logs, or PII; summarize with lengths, hashes, and short non-sensitive
prefixes when identity is needed.
`;

function applyCodexSkillOverlays(skillName, content) {
	if (skillName === "start-work") {
		return content
			.replace(startWorkOriginalCompletion, startWorkCodexCompletion)
			.replace(startWorkOriginalHardRule, startWorkCodexHardRule);
	}
	if (skillName === "review-work" && !content.includes("When `review-work` is used as a final implementation")) {
		return content.replace(reviewWorkAnchor, `${reviewWorkAnchor}${reviewWorkCodexGate}`);
	}
	return content;
}

async function adaptSkillForCodex(skillName) {
	const skillPath = join(skillsRoot, skillName, "SKILL.md");
	const content = await readFile(skillPath, "utf8");
	const adapted = applyCodexSkillOverlays(skillName, insertCodexCompatibilityGuidance(content));
	if (adapted !== content) {
		await writeFile(skillPath, adapted, "utf8");
	}
}

async function syncSkills() {
	await rm(skillsRoot, { recursive: true, force: true });
	await mkdir(skillsRoot, { recursive: true });

	for (const [name, source] of skillSources) {
		await cp(join(root, source), join(skillsRoot, name), { recursive: true });
		await adaptSkillForCodex(name);
	}

	const sharedSkillEntries = await readdir(sharedSkillsRoot, { withFileTypes: true });
	const sharedSkillNames = sharedSkillEntries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	for (const skillName of sharedSkillNames) {
		await cp(join(sharedSkillsRoot, skillName), join(skillsRoot, skillName), {
			filter: (source) => !sourceTestFilePattern.test(source),
			recursive: true,
		});
		await adaptSkillForCodex(skillName);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await syncSkills();
}
