#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sharedSkillsRoot = sharedSkillsRootPath();
const skillsRoot = join(root, "skills");
const sourceTestFilePattern = /\.test\.ts$/;
const ignoredSkillSourceDirNames = new Set([".mypy_cache", ".omo", ".pytest_cache", ".ruff_cache", "__pycache__"]);
const ignoredSkillSourceFileNames = new Set([".gitignore", ".npmignore", "pyrightconfig.json"]);
const skillSources = [
	["comment-checker", "components/comment-checker/skills/comment-checker"],
	["lsp", "components/lsp/skills/lsp"],
	["rules", "components/rules/skills/rules"],
	["teammode", "components/teammode/skills/teammode"],
	["ulw-loop", "components/ulw-loop/skills/ulw-loop"],
	["ulw-plan", "components/ultrawork/skills/ulw-plan"],
];
const componentSkillNames = new Set(skillSources.map(([name]) => name));
const skillDisplayPrefix = "(OmO) ";

function shouldCopySkillSource(source) {
	const normalized = source.replaceAll("\\", "/");
	const segments = normalized.split("/");
	const name = segments.at(-1) ?? "";
	if (segments.some((segment) => ignoredSkillSourceDirNames.has(segment))) return false;
	if (ignoredSkillSourceFileNames.has(name)) return false;
	if (sourceTestFilePattern.test(name) || name.endsWith(".pyc")) return false;
	const scriptsIndex = segments.lastIndexOf("scripts");
	return scriptsIndex === -1 || segments[scriptsIndex + 1] !== "tests";
}

const opencodeOnlyOrchestrationPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/;

const codexHarnessToolCompatibility = `## Codex Harness Tool Compatibility

This skill may include examples copied from the OpenCode harness. In Codex, do not call OpenCode-only tools such as \`call_omo_agent(...)\`, \`task(...)\`, \`background_output(...)\`, or \`team_*(...)\` literally. Translate those examples to Codex native tools:

| OpenCode example | Codex tool to use |
| --- | --- |
| \`call_omo_agent(subagent_type="explore", ...)\` | \`multi_agent_v1.spawn_agent({"message":"TASK: act as an explorer. ...","agent_type":"explorer","fork_context":false})\` |
| \`call_omo_agent(subagent_type="librarian", ...)\` | \`multi_agent_v1.spawn_agent({"message":"TASK: act as a librarian. ...","agent_type":"librarian","fork_context":false})\` |
| \`task(subagent_type="plan", ...)\` | \`multi_agent_v1.spawn_agent({"message":"TASK: act as a planning agent. ...","agent_type":"plan","fork_context":false})\` |
| \`task(subagent_type="oracle", ...)\` for final verification | \`multi_agent_v1.spawn_agent({"message":"TASK: act as a rigorous reviewer. ...","agent_type":"lazycodex-gate-reviewer","fork_context":false})\` |
| \`task(category="...", ...)\` for implementation or QA | \`multi_agent_v1.spawn_agent({"message":"TASK: act as an implementation or QA worker. ...","fork_context":false})\` |
| \`background_output(task_id="...")\` | \`multi_agent_v1.wait_agent(...)\` for mailbox signals |
| \`team_*(...)\` | Use Codex native subagents via \`multi_agent_v1.spawn_agent\`, \`multi_agent_v1.send_input\`, \`multi_agent_v1.wait_agent\`, and \`multi_agent_v1.close_agent\` |

Role-specific behavior must be described in a self-contained \`message\`. Use \`fork_context: false\` to start the child with only the initial prompt (no parent history); use \`fork_context: true\` only when full parent history is truly required. Include any required conversation context, files, diffs, constraints, and requested skill names directly in the spawned agent's \`message\`. OMO installs these selectable agent roles into \`~/.codex/agents/\`: \`explorer\`, \`librarian\`, \`plan\`, \`momus\`, \`metis\`, \`lazycodex-code-reviewer\`, \`lazycodex-qa-executor\`, and \`lazycodex-gate-reviewer\` - pass the matching name as \`agent_type\` so the child gets that role's model and instructions. If the spawn tool exposes no \`agent_type\` parameter, omit it and describe the role inside \`message\`. If a code block below conflicts with this section, this section wins.

For work likely to exceed one wait cycle, require the child to send \`WORKING: <task> - <current phase>\` before long passes and \`BLOCKED: <reason>\` only when progress stops. A \`multi_agent_v1.wait_agent\` timeout only means no new mailbox update arrived. Treat a running child as alive. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly \`BLOCKED:\`, or no longer running.

`;

const codexCompatibilityEndMarkers = [
	"For work likely to exceed one wait cycle, require the child to send `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. A `multi_agent_v1.wait_agent` timeout only means no new mailbox update arrived. Treat a running child as alive. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running.\n\n",
	"Role-specific behavior must be described in a self-contained `message`. Use `fork_context: false` to start the child with only the initial prompt (no parent history); use `fork_context: true` only when full parent history is truly required. Include any required conversation context, files, diffs, constraints, and requested skill names directly in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
	"When translating `load_skills=[...]`, include the requested skill names in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
	"When translating `load_skills=[...]`, name the skills inside the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
];

function findCodexCompatibilitySectionEnd(content, searchStart) {
	const structuralEndPattern = /\n(?:---|export\s+const\s+|#{1,6}\s)/g;
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

function hasKnownGeneratedCodexCompatibilityGuidance(content, compatibilityIndex) {
	return codexCompatibilityEndMarkers.some((marker) => content.indexOf(marker, compatibilityIndex) !== -1);
}

export function insertCodexCompatibilityGuidance(content) {
	if (!opencodeOnlyOrchestrationPattern.test(content)) return content;
	const firstExampleIndex = content.search(opencodeOnlyOrchestrationPattern);
	const compatibilityIndex = content.indexOf("## Codex Harness Tool Compatibility");
	if (
		compatibilityIndex !== -1 &&
		compatibilityIndex < firstExampleIndex &&
		!hasKnownGeneratedCodexCompatibilityGuidance(content, compatibilityIndex)
	) {
		return content;
	}

	const contentWithoutGuidance = removeCodexCompatibilityGuidance(content);

	const frontmatterMatch = contentWithoutGuidance.match(/^---\n[\s\S]*?\n---\n+/);
	if (!frontmatterMatch) {
		return `${codexHarnessToolCompatibility}${contentWithoutGuidance}`;
	}

	return `${frontmatterMatch[0]}${codexHarnessToolCompatibility}${contentWithoutGuidance.slice(frontmatterMatch[0].length)}`;
}

const startWorkOriginalCompletion = `When all top-level checkboxes in \`## TODOs\` and \`## Final Verification Wave\` are complete:

1. Run the plan's final verification commands.
2. For PR/branch work, finish the lifecycle from the task-owned worktree: sync \`.omo/\` state back to the main repo, create or update the PR, wait for review/verification gates, merge by default unless explicitly opted out, and remove the worktree only after successful merge or explicit handoff.
3. Remove or mark the Boulder work as completed.
4. Print an \`ORCHESTRATION COMPLETE\` block with the plan path, verification commands, artifacts, and cleanup receipts.`;

const startWorkCodexCompletion = `When all top-level checkboxes in \`## TODOs\` and \`## Final Verification Wave\` are complete:

1. Run the plan's final verification commands.
2. Complete the **Global Review and Debugging Gate** before any completion claim, PR creation, PR handoff, branch handoff, or merge:
   - Invoke the \`review-work\` skill with the final diff, changed files, user goal, constraints, run command, and verification evidence. All five review lanes must return PASS. A timeout, missing deliverable, ack-only child, \`BLOCKED:\`, or inconclusive lane is a gate failure, not approval.
   - Run a debugging-oriented runtime audit even when the review passes: name at least three plausible failure hypotheses for the changed surface, run the distinguishing checks against the actual artifact, and append the ruled-out or confirmed result to \`.omo/start-work/ledger.jsonl\`.
   - If any review lane or debugging hypothesis fails, invoke the \`debugging\` skill, confirm root cause with runtime evidence, add the minimal failing test or reproduction, fix it, rerun the affected verification, then rerun the Global Review and Debugging Gate.
   - Evidence hygiene is mandatory: redact or mask secrets and sensitive user data before writing \`.omo/start-work/ledger.jsonl\`, a PR body, or a handoff. Never include raw tokens, credentials, auth headers, cookies, API keys, env dumps, private logs, or PII; use concise summaries, lengths, hashes, or short non-sensitive prefixes instead.
   - If the work includes creating, updating, or handing off a PR, refresh \`git status\` and the PR/branch state from the task-owned worktree after the gate, and include only redacted review/debugging evidence in the PR body or handoff.
3. Finish the PR/branch lifecycle from its task-owned worktree: sync \`.omo/\` state back to the main repo, create or update the PR when requested, wait for CI/review/Cubic gates, merge by default unless explicitly opted out, and remove the worktree only after successful merge or explicit handoff.
4. Remove or mark the Boulder work as completed.
5. Print an \`ORCHESTRATION COMPLETE\` block with the plan path, verification commands, Global Review and Debugging Gate verdict, artifacts, and cleanup receipts.`;

const startWorkOriginalHardRule = "- No completion claim while an applicable ultraqa adversarial class was never probed. Each applicable class needs a captured observable result; each skipped class needs a one-line not-applicable reason in the ledger.\n- No PR/branch implementation, review, or merge in the main worktree; use the task-owned git worktree.\n- No unprefixed session ids in Boulder state. Codex sessions are always `codex:<session_id>`.";

const startWorkCodexHardRule = "- No completion claim while an applicable ultraqa adversarial class was never probed. Each applicable class needs a captured observable result; each skipped class needs a one-line not-applicable reason in the ledger.\n- No `ORCHESTRATION COMPLETE`, final response, PR creation, PR handoff, or merge before the Global Review and Debugging Gate passes with recorded evidence.\n- No PR/branch implementation or review in the main worktree; create or use a task-owned git worktree first.\n- No unprefixed session ids in Boulder state. Codex sessions are always `codex:<session_id>`.";

const reviewWorkAnchor = "Launch 5 specialized sub-agents in parallel to review completed implementation work from every angle. All 5 must pass for the review to pass. If even ONE fails, the review fails.\n";

const reviewWorkCodexGate = `
When \`review-work\` is used as a final implementation, PR, or \`$start-work\`
gate, it is blocking. A timeout, missing deliverable, ack-only response,
explicit \`BLOCKED:\`, or inconclusive lane is not a pass. Treat that lane as
failed, investigate the underlying uncertainty with the \`debugging\` skill when
runtime behavior may be wrong, fix with evidence, and rerun the affected lane
before claiming completion, creating or handing off a PR, or merging.

When reviewing a PR or branch, collect diff, file contents, and verification
results from a dedicated review worktree attached to that branch. Never
checkout, test, or edit the review branch in the main worktree.

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

function readSkillFrontmatterName(content, fallbackName) {
	const frontmatter = content.match(/^---\n(?<body>[\s\S]*?)\n---\n+/);
	const rawName = frontmatter?.groups?.body.match(/^name:\s*"?([^"\n]+)"?\s*$/m)?.[1]?.trim();
	return rawName && rawName.length > 0 ? rawName : fallbackName;
}

function upsertDisplayName(metadata, displayName) {
	const content = metadata.endsWith("\n") ? metadata : `${metadata}\n`;
	if (/^\s*display_name:/m.test(metadata)) {
		return content.replace(/^(\s*display_name:\s*).+$/m, `$1"${displayName}"`);
	}
	if (/^interface:\s*$/m.test(metadata)) {
		return content.replace(/^interface:\s*$/m, `interface:\n  display_name: "${displayName}"`);
	}
	return `interface:\n  display_name: "${displayName}"\n${content}`;
}

async function writeCodexSkillDisplayMetadata(skillName) {
	const skillRoot = join(skillsRoot, skillName);
	const skillPath = join(skillRoot, "SKILL.md");
	const content = await readFile(skillPath, "utf8");
	const frontmatterName = readSkillFrontmatterName(content, skillName);
	const metadataDir = join(skillRoot, "agents");
	const metadataPath = join(metadataDir, "openai.yaml");
	await mkdir(metadataDir, { recursive: true });
	let metadata = "interface:\n";
	try {
		metadata = await readFile(metadataPath, "utf8");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
	await writeFile(metadataPath, upsertDisplayName(metadata, `${skillDisplayPrefix}${frontmatterName}`), "utf8");
}

async function adaptSkillForCodex(skillName) {
	const skillPath = join(skillsRoot, skillName, "SKILL.md");
	const content = await readFile(skillPath, "utf8");
	const adapted = applyCodexSkillOverlays(skillName, insertCodexCompatibilityGuidance(content));
	if (adapted !== content) {
		await writeFile(skillPath, adapted, "utf8");
	}
	await writeCodexSkillDisplayMetadata(skillName);
}

async function syncSkills() {
	await rm(skillsRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
		if (componentSkillNames.has(skillName)) continue;
		await cp(join(sharedSkillsRoot, skillName), join(skillsRoot, skillName), {
			filter: shouldCopySkillSource,
			recursive: true,
		});
		await adaptSkillForCodex(skillName);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await syncSkills();
}
