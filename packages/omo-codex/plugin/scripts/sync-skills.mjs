#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCanonicalUltraworkDirectivePath } from "./canonical-ultrawork-directive.mjs";
import { isCliEntry } from "./entry-guard.mjs";
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills";
import { createSkillSourceCopyFilter } from "@oh-my-opencode/shared-skills/skill-source-filter";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(root, "..", "..", "..");
const sharedSkillsRoot = sharedSkillsRootPath();
const skillsRoot = join(root, "skills");
// The ultrawork skill body is the canonical prompts-core directive, read DIRECTLY here rather than
// from a component-local copy: sync-skills runs before build-components (see plugin/package.json
// build chain), so consuming components/ultrawork/scripts/sync-directive.mjs output would break a
// clean checkout.
const canonicalUltraworkDirectivePath = resolveCanonicalUltraworkDirectivePath(root, repoRoot);
const ultraworkSkillFrontmatter = `---
name: ultrawork
description: Binding ultrawork mode directive for omo on Codex. When a prompt contains ultrawork or ulw, the omo UserPromptSubmit hook injects a short bootstrap that points at this file. Read the whole file and follow every rule in it for the rest of the task.
metadata:
  short-description: Binding ultrawork mode directive
---

`;
const skillSources = [
	["comment-checker", "components/comment-checker/skills/comment-checker"],
	["lcx-contribute-bug-fix", "components/lcx/skills/lcx-contribute-bug-fix"],
	["lcx-doctor", "components/lcx/skills/lcx-doctor"],
	["lcx-report-bug", "components/lcx/skills/lcx-report-bug"],
	["lsp", "components/lsp/skills/lsp"],
	["rules", "components/rules/skills/rules"],
	["teammode", "components/teammode/skills/teammode"],
	["ulw-loop", "components/ulw-loop/skills/ulw-loop"],
	["ulw-plan", "components/ultrawork/skills/ulw-plan"],
];
const componentSkillNames = new Set([...skillSources.map(([name]) => name), "ultrawork"]);
const skillDisplayPrefix = "(OmO) ";

const opencodeOnlyOrchestrationPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/;

export const codexHarnessToolCompatibility = `## Codex Harness Tool Compatibility

This skill may include examples copied from the OpenCode harness. In Codex, do not call OpenCode-only tools such as \`call_omo_agent(...)\`, \`task(...)\`, \`background_output(...)\`, or \`team_*(...)\` literally. Translate those examples to Codex native tools:

| OpenCode example | Codex tool to use |
| --- | --- |
| \`call_omo_agent(subagent_type="explore", ...)\` | \`multi_agent_v1.spawn_agent({"message":"TASK: act as an explorer. ...","agent_type":"explorer","fork_context":false})\` |
| \`call_omo_agent(subagent_type="librarian", ...)\` | \`multi_agent_v1.spawn_agent({"message":"TASK: act as a librarian. ...","agent_type":"librarian","fork_context":false})\` |
| \`task(subagent_type="plan", ...)\` | \`multi_agent_v1.spawn_agent({"message":"TASK: act as a planning agent. ...","agent_type":"plan","fork_context":false})\` |
| \`task(subagent_type="oracle", ...)\` for final verification | By default, record a self-review in the notepad: re-read the diff, run diagnostics, and capture evidence for every acceptance criterion. Only when the user demanded strict, rigorous, or high-accuracy review, use \`multi_agent_v1.spawn_agent({"message":"TASK: act as a rigorous reviewer. ...","agent_type":"lazycodex-gate-reviewer","fork_context":false})\`; include \`fork_context: false\`. |
| \`task(category="...", ...)\` for implementation or QA | \`multi_agent_v1.spawn_agent({"message":"TASK: act as an implementation or QA worker. ...","agent_type":"lazycodex-worker-medium","fork_context":false})\` |
| \`background_output(task_id="...")\` | \`multi_agent_v1.wait_agent(...)\` for mailbox signals |
| \`team_*(...)\` | Use Codex native subagents via \`multi_agent_v1.spawn_agent\` and \`multi_agent_v1.wait_agent\`; use \`multi_agent_v1.send_input\` and \`multi_agent_v1.close_agent\` only when exposed in the active tools list |

Role-specific behavior must be described in a self-contained \`message\`. Use \`fork_context: false\` to start the child with only the initial prompt (no parent history); use \`fork_context: true\` only when full parent history is truly required. Include any required conversation context, files, diffs, constraints, and requested skill names directly in the spawned agent's \`message\`. OMO installs these selectable agent roles into \`~/.codex/agents/\`: \`explorer\`, \`librarian\`, \`plan\`, \`momus\`, \`metis\`, \`lazycodex-code-reviewer\`, \`lazycodex-qa-executor\`, and \`lazycodex-gate-reviewer\` - pass the matching name as \`agent_type\` so the child gets that role's model and instructions. Inspect the actual spawn schema: whenever \`agent_type\` is exposed, EVERY spawn MUST select an exact LazyCodex role, on V1 or V2. Implementation difficulty selects \`lazycodex-worker-low\`, \`lazycodex-worker-medium\`, or \`lazycodex-worker-high\`; clone QA can select \`lazycodex-clone-fidelity-reviewer\`. Never select generic \`worker\` or \`default\`. If a code block below conflicts with this section, this section wins.

Codex exposes ONE of two subagent tool surfaces per session; check your own tool list and route accordingly. If \`multi_agent_v1.*\` tools exist, use the table above as written. If instead a flat \`spawn_agent\` with a required \`task_name\` exists (\`multi_agent_v2\`), rewrite every \`multi_agent_v1.*\` example: \`multi_agent_v1.spawn_agent({...,"fork_context":false})\` becomes \`spawn_agent({"task_name":"<lowercase_digits_underscores>","message":...,"agent_type":...,"fork_turns":"none"})\` (\`"all"\` only when full parent history is truly required); \`send_input\` becomes \`send_message\`; do not call \`close_agent\`/\`resume_agent\` (finished agents end on their own; \`followup_task\` re-tasks one, \`interrupt_agent\` stops one); \`wait_agent\` takes only \`timeout_ms\` and returns on any child mailbox activity. Do not infer role support from V1/V2 or a model version. Legacy-schema exception: only if the actual schema lacks \`agent_type\`, omit that unsupported field and carry the complete role instructions in \`message\`, with history explicitly disabled. This cannot select a specialized TOML; an installed managed default supplies the medium worker for unnamed non-forks. The guard has no schema metadata and rejects unnamed calls, so report incompatible routing instead of retrying generically. Every deliberate full-history fork must still name its role: Codex skips role application on unnamed full-history forks, an upstream gap no LazyCodex default can repair. If a code block below conflicts with this section, this section wins. \`fork_context\` is rejected on \`multi_agent_v2\` (\`fork_context is not supported in MultiAgentV2; use fork_turns instead\`).

When translating \`load_skills=[...]\`, include the requested skill names in the spawned agent's \`message\`. If a code block below conflicts with this section, this section wins.

Omit optional keys you do not set. Never send \`items: []\`, \`message: ""\`, \`model: ""\`, \`reasoning_effort: ""\`, or \`service_tier: ""\` — Codex rejects them (\`Items can't be empty\`, \`reasoning_effort must not be empty\`).

For work likely to exceed one wait cycle, require the child to send \`WORKING: <task> - <current phase>\` before long passes and \`BLOCKED: <reason>\` only when progress stops. A \`multi_agent_v1.wait_agent\` timeout only means no new mailbox update arrived; back off between waits (double the timeout up to ~5 minutes) instead of spinning short cycles. Treat a running child as alive. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly \`BLOCKED:\`, or no longer running.

`;

const codexCompatibilityEndMarkers = [
	"Omit optional keys you do not set. Never send `items: []`, `message: \"\"`, `model: \"\"`, `reasoning_effort: \"\"`, or `service_tier: \"\"` — Codex rejects them (`Items can't be empty`, `reasoning_effort must not be empty`).\n\nFor work likely to exceed one wait cycle, require the child to send `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. A `multi_agent_v1.wait_agent` timeout only means no new mailbox update arrived; back off between waits (double the timeout up to ~5 minutes) instead of spinning short cycles. Treat a running child as alive. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running.\n\n",
	"On the v2 surface `agent_type` may be ABSENT from the spawn schema (verified 2026-07-11: only `fork_turns`/`message`/`task_name`) — when absent, omit it and describe the role inside `message`; installed role TOMLs cannot be selected on that surface. If a code block below conflicts with this section, this section wins. `fork_context` is rejected on `multi_agent_v2` (`fork_context is not supported in MultiAgentV2; use fork_turns instead`).\n\n",
	"For work likely to exceed one wait cycle, require the child to send `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. A `multi_agent_v1.wait_agent` timeout only means no new mailbox update arrived. Treat a running child as alive. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running.\n\n",
	"On `multi_agent_v2` sessions the same `agent_type` applies (the OMO installer exposes it) with `fork_turns` instead of `fork_context`. If a code block below conflicts with this section, this section wins.\n\n",
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

export function insertCodexCompatibilityGuidance(content, force = false) {
	if (!force && !opencodeOnlyOrchestrationPattern.test(content)) return content;
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

export const reviewWorkAnchor = "Review completed implementation work through exactly two lanes: your own hands-on manual QA on the real surface, and ONE gate reviewer sub-agent that audits the whole change set against the goal, the constraints, and your QA evidence. The review passes only when the QA matrix has no failing row AND the gate reviewer returns APPROVE.\n";

const reviewWorkCodexGate = `
On Codex, use \`review-work\` only when the user asks for a review or demands
strict, rigorous, or high-accuracy verification, not automatically for a PR or
completion claim. Your own manual QA and the main session's self-review are
the default. Spawn ONE \`lazycodex-gate-reviewer\` only for an explicit demand
for strict review; otherwise run the review checklist inline and record the
main session's verdict instead of spawning or waiting for a reviewer. These
Codex rules override the mandatory-reviewer instructions in the shared skill.

When \`review-work\` is used as a final implementation, PR, or \`$ulw-execute\`
gate, the selected review is blocking. A timeout, missing deliverable, ack-only response,
explicit \`BLOCKED:\`, or inconclusive lane is not a pass. Treat that lane as
failed, investigate the underlying uncertainty with the \`debugging\` skill when
runtime behavior may be wrong, fix with evidence, and rerun the affected lane
before claiming completion, creating or handing off a PR, or merging.

After each lane reaches PASS, immediately append a durable task-evidence record
to the active ledger with the lane name, exact full commit SHA, PASS verdict,
and report artifact/source. Before reusing coverage after continuation or
compaction, re-read that record and require the exact lane/SHA pair. Memory,
chat history, or an unstamped report is not coverage; a new commit requires
fresh applicable lane records.

A rejecting lane must name its blockers inline in its final message — each
blocker cites the violated goal criterion or requirement plus an evidence
pointer. A bare REJECT/FAIL token without findings is not a verdict; treat it
as an inconclusive lane (one bounded respawn, then record it inconclusive with
that reason).

When reviewing a PR or branch, collect diff, file contents, and verification
results from a dedicated review worktree attached to that branch. Never
checkout, test, or edit the review branch in the main worktree.

Review evidence must be safe to share. Redact or mask secrets and sensitive
user data before including evidence in logs, PR bodies, or handoffs. Never
include raw tokens, credentials, auth headers, cookies, API keys, env dumps,
private logs, or PII; summarize with lengths, hashes, and short non-sensitive
prefixes when identity is needed.
`;

const ulwResearchOriginalDeliveryGates = "### The delivery gates \u2014 every gate must PASS, in order\n\nNothing reaches the user until the gates pass:\n\n1. **Visual QA (always).** Render the produced artifact back to images \u2014 PDF pages to PNG, the HTML in a real browser \u2014 and look at them: missing or broken figures, images stretched or spilling their containers, diagram or chart text rendered off the spec's font or palette, clipped tables, overflowing CJK text, blank pages, unlabeled chart values, wrong page breaks. Fix and re-render until the pages are clean. Reading the source markup is not visual QA; inspect the pixels.\n2. **Proofread gate \u2014 `task(category=\"writing\", ...)`.** Hand the final text to a dedicated `writing` worker whose only job is language: grammar, spelling, punctuation, terminology consistency, and whether the prose reads NATIVELY in the report's own language. It returns a defect list; fix every item and re-run the gate on the delta. Deliver only on a clean pass \u2014 this gate runs BEFORE the first delivery, not after the user finds the typo.";
const ulwResearchCodexDeliveryGate = "### The delivery gate \u2014 visual QA must PASS\n\nNothing reaches the user until the gate passes:\n\n**Visual QA (always).** Render the produced artifact back to images \u2014 PDF pages to PNG, the HTML in a real browser \u2014 and look at them: missing or broken figures, images stretched or spilling their containers, diagram or chart text rendered off the spec's font or palette, clipped tables, overflowing CJK text, blank pages, unlabeled chart values, wrong page breaks. Fix and re-render until the pages are clean. Reading the source markup is not visual QA; inspect the pixels.";

export const ulwExecuteOriginalCompletion = [
	"When all top-level checkboxes in `## TODOs` and `## Final Verification Wave` are complete:",
	"",
	"1. Run the plan's final verification commands.",
	"2. For PR/branch work, finish the lifecycle from the last phase's worktree: sync `.omo/` state back to the main repo, create or update the PR, wait for review/verification gates, merge by default unless explicitly opted out, and remove the worktree only after successful merge or explicit handoff.",
	"3. Remove or mark the Boulder work as completed.",
	"4. Print an `ORCHESTRATION COMPLETE` block with the plan path, verification commands, artifacts, and cleanup receipts.",
].join("\n");
export const ulwExecuteOriginalHardRule = [
	"- No production change before a failing-first proof exists (unit test at a seam, otherwise the failing Manual-QA scenario), and no change to existing behavior before a baseline characterization test pins the current behavior and passes on the unchanged code.",
	"- No `--dry-run` as completion evidence.",
	"- No tests-only completion claim. A Manual-QA artifact is required.",
	"- **NO DIRECT IMPLEMENTATION BY THE ORCHESTRATOR.** Root NEVER edits product files, writes tests, or runs QA itself — a spawned worker does.",
	"- No completion claim while an applicable ultraqa adversarial class was never probed. Each applicable class needs a captured observable result; each skipped class needs a one-line not-applicable reason in the ledger.",
	"- No implementation, review, or merge in the main checkout; every phase works in its task-owned worktree.",
	"- No unprefixed session ids in Boulder state. Sessions are always recorded as `codex:<session_id>`.",
	"- No stale-memory execution. The plan and ledger are the durable source of truth.",
].join("\n");
const ulwExecuteCodexCompletion = [
	"When all top-level checkboxes in `## TODOs` and `## Final Verification Wave` are complete:",
	"",
	"1. Run the plan's final verification commands.",
	"2. Record a self-review in the notepad: re-read the diff, run diagnostics, and capture evidence for every acceptance criterion. Run your own manual QA on the real surface.",
	"3. Only when the user demanded strict, rigorous, or high-accuracy review, spawn ONE `lazycodex-gate-reviewer`; otherwise your self-review is the final verification.",
	"4. Finish the PR/branch lifecycle from its task-owned worktree: sync `.omo/` state back to the main repo, create or update the PR, wait for review/verification gates, merge by default unless explicitly opted out, and remove the worktree only after successful merge or explicit handoff.",
	"5. Remove or mark the Boulder work as completed.",
	"6. Print an `ORCHESTRATION COMPLETE` block with the plan path, verification commands, artifacts, and cleanup receipts.",
].join("\n");
const ulwExecuteCodexHardRule = [
	"- No production change before a failing-first proof exists (unit test at a seam, otherwise the failing Manual-QA scenario), and no change to existing behavior before a baseline characterization test pins the current behavior and passes on the unchanged code.",
	"- No `--dry-run` as completion evidence.",
	"- No tests-only completion claim. A Manual-QA artifact is required.",
	"- **NO DIRECT IMPLEMENTATION BY THE ORCHESTRATOR.** Root NEVER edits product files, writes tests, or runs QA itself — a spawned worker does.",
	"- No completion claim while an applicable ultraqa adversarial class was never probed. Each applicable class needs a captured observable result; each skipped class needs a one-line not-applicable reason in the ledger.",
	"- No implementation, review, or merge in the main checkout; every phase works in a task-owned worktree.",
	"- No unprefixed session ids in Boulder state. Sessions are always recorded as `codex:<session_id>`.",
	"- No stale-memory execution. The plan and ledger are the durable source of truth.",
	"- Codex final verification is the exception to the delegated-QA-only rule above: perform your own manual QA on the real surface and record a self-review before completion.",
].join("\n");

export function applyCodexSkillOverlays(skillName, content) {
	if (skillName === "ulw-research") {
		return content.replace(ulwResearchOriginalDeliveryGates, ulwResearchCodexDeliveryGate);
	}
	if (skillName === "ulw-execute") {
		return content
			.replace(ulwExecuteOriginalCompletion, ulwExecuteCodexCompletion)
			.replace(ulwExecuteOriginalHardRule, ulwExecuteCodexHardRule);
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
	const needsSpawnPayloadGuidance = ["ulw-loop", "review-work", "ulw-execute"].includes(skillName);
	const adapted = applyCodexSkillOverlays(skillName, insertCodexCompatibilityGuidance(content, needsSpawnPayloadGuidance));
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

	await mkdir(join(skillsRoot, "ultrawork"), { recursive: true });
	const canonicalUltraworkDirective = await readFile(canonicalUltraworkDirectivePath, "utf8");
	await writeFile(
		join(skillsRoot, "ultrawork", "SKILL.md"),
		`${ultraworkSkillFrontmatter}${canonicalUltraworkDirective}`,
		"utf8",
	);
	await adaptSkillForCodex("ultrawork");

	const sharedSkillEntries = await readdir(sharedSkillsRoot, { withFileTypes: true });
	const sharedSkillNames = sharedSkillEntries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	for (const skillName of sharedSkillNames) {
		if (componentSkillNames.has(skillName)) continue;
		const sharedSkillSource = join(sharedSkillsRoot, skillName);
		await cp(sharedSkillSource, join(skillsRoot, skillName), {
			filter: createSkillSourceCopyFilter(sharedSkillSource),
			recursive: true,
		});
		await adaptSkillForCodex(skillName);
	}
}

if (isCliEntry(import.meta.url)) {
	await syncSkills();
}
