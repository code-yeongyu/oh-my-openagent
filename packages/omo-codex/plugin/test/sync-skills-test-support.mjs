import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const CONTEXT_PRESSURE_SKILL_BUDGET_BYTES = 25_000;

export const expectedSkills = [
	"ast-grep",
	"coding-agent-sessions",
	"comment-checker",
	"data-scientist",
	"debugging",
	"frontend",
	"git-master",
	"init-deep",
	"lcx-contribute-bug-fix",
	"lcx-doctor",
	"lcx-report-bug",
	"lsp",
	"lsp-setup",
	"programming",
	"refactor",
	"remove-ai-slops",
	"review-work",
	"rules",
	"teammode",
	"ultimate-browsing",
	"ultrawork",
	"ulw-execute",
	"ulw-loop",
	"ulw-plan",
	"ulw-research",
	"visual-qa",
];

// `ultrawork` is intentionally absent: its skill body is composed by sync-skills.mjs directly from
// the canonical packages/prompts-core/prompts/ultrawork/codex.md, so it has no component skill
// source directory to diff against. Its composition is asserted separately in sync-skills.test.mjs.
export const componentSkillSources = [
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

export const canonicalUltraworkDirectiveRelativePath = join(
	"packages",
	"prompts-core",
	"prompts",
	"ultrawork",
	"codex.md",
);

const codexCompatibilityEndMarkers = [
	"Omit optional keys you do not set. Never send `items: []`, `message: \"\"`, `model: \"\"`, `reasoning_effort: \"\"`, or `service_tier: \"\"` — Codex rejects them (`Items can't be empty`, `reasoning_effort must not be empty`).\n\nFor work likely to exceed one wait cycle, require the child to send `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. A `multi_agent_v1.wait_agent` timeout only means no new mailbox update arrived; back off between waits (double the timeout up to ~5 minutes) instead of spinning short cycles. Treat a running child as alive. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running.\n\n",
	"On the v2 surface `agent_type` may be ABSENT from the spawn schema (verified 2026-07-11: only `fork_turns`/`message`/`task_name`) — when absent, omit it and describe the role inside `message`; installed role TOMLs cannot be selected on that surface. If a code block below conflicts with this section, this section wins. `fork_context` is rejected on `multi_agent_v2` (`fork_context is not supported in MultiAgentV2; use fork_turns instead`).\n\n",
	"For work likely to exceed one wait cycle, require the child to send `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. A `multi_agent_v1.wait_agent` timeout only means no new mailbox update arrived. Treat a running child as alive. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running.\n\n",
	"On `multi_agent_v2` sessions the same `agent_type` applies (the OMO installer exposes it) with `fork_turns` instead of `fork_context`. If a code block below conflicts with this section, this section wins.\n\n",
	"Role-specific behavior must be described in a self-contained `message`. Use `fork_context: false` to start the child with only the initial prompt (no parent history); use `fork_context: true` only when full parent history is truly required. Include any required conversation context, files, diffs, constraints, and requested skill names directly in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
	"When translating `load_skills=[...]`, include the requested skill names in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
	"When translating `load_skills=[...]`, name the skills inside the spawned agent's `message`. If a code block below conflicts with this section, this section wins.\n\n",
];

export function removeCodexCompatibilityGuidance(content) {
	const start = content.indexOf("## Codex Harness Tool Compatibility\n\n");
	if (start === -1) return content;
	const structuralEndPattern = /\n(?:---|export\s+const\s+|#{1,6}\s)/g;
	structuralEndPattern.lastIndex = start + "## Codex Harness Tool Compatibility\n\n".length;
	const structuralEnd = structuralEndPattern.exec(content);
	if (structuralEnd) return `${content.slice(0, start)}${content.slice(structuralEnd.index + 1)}`;

	const endMarker = codexCompatibilityEndMarkers.find((marker) => content.indexOf(marker, start) !== -1);
	assert.notEqual(endMarker, undefined, "Codex compatibility guidance block is missing its terminator");
	const end = content.indexOf(endMarker, start);
	assert.notEqual(end, -1, "Codex compatibility guidance block is missing its terminator");
	return `${content.slice(0, start)}${content.slice(end + endMarker.length)}`;
}

const ulwExecuteOriginalCompletion = `When all top-level checkboxes in \`## TODOs\` and \`## Final Verification Wave\` are complete:

1. Run the plan's final verification commands.
2. For PR/branch work, finish the lifecycle from the last phase's worktree: sync \`.omo/\` state back to the main repo, create or update the PR, wait for review/verification gates, merge by default unless explicitly opted out, and remove the worktree only after successful merge or explicit handoff.
3. Remove or mark the Boulder work as completed.
4. Print an \`ORCHESTRATION COMPLETE\` block with the plan path, verification commands, artifacts, and cleanup receipts.`;

const ulwExecuteCodexCompletion = `When all top-level checkboxes in \`## TODOs\` and \`## Final Verification Wave\` are complete:

1. Run the plan's final verification commands.
2. Record a self-review in the notepad: re-read the diff, run diagnostics, and capture evidence for every acceptance criterion. Run your own manual QA on the real surface.
3. Only when the user demanded strict, rigorous, or high-accuracy review, spawn ONE \`lazycodex-gate-reviewer\`; otherwise your self-review is the final verification.
4. Finish the PR/branch lifecycle from its task-owned worktree: sync \`.omo/\` state back to the main repo, create or update the PR, wait for review/verification gates, merge by default unless explicitly opted out, and remove the worktree only after successful merge or explicit handoff.
5. Remove or mark the Boulder work as completed.
6. Print an \`ORCHESTRATION COMPLETE\` block with the plan path, verification commands, artifacts, and cleanup receipts.`;

const ulwExecuteOriginalHardRule = `- No production change before a failing-first proof exists (unit test at a seam, otherwise the failing Manual-QA scenario), and no change to existing behavior before a baseline characterization test pins the current behavior and passes on the unchanged code.
- No \`--dry-run\` as completion evidence.
- No tests-only completion claim. A Manual-QA artifact is required.
- **NO DIRECT IMPLEMENTATION BY THE ORCHESTRATOR.** Root NEVER edits product files, writes tests, or runs QA itself — a spawned worker does.
- No completion claim while an applicable ultraqa adversarial class was never probed. Each applicable class needs a captured observable result; each skipped class needs a one-line not-applicable reason in the ledger.
- No implementation, review, or merge in the main checkout; every phase works in its task-owned worktree.
- No unprefixed session ids in Boulder state. Sessions are always recorded as \`codex:<session_id>\`.
- No stale-memory execution. The plan and ledger are the durable source of truth.`;

const ulwExecuteCodexHardRule = `- No production change before a failing-first proof exists (unit test at a seam, otherwise the failing Manual-QA scenario), and no change to existing behavior before a baseline characterization test pins the current behavior and passes on the unchanged code.
- No \`--dry-run\` as completion evidence.
- No tests-only completion claim. A Manual-QA artifact is required.
- **NO DIRECT IMPLEMENTATION BY THE ORCHESTRATOR.** Root NEVER edits product files, writes tests, or runs QA itself — a spawned worker does.
- No completion claim while an applicable ultraqa adversarial class was never probed. Each applicable class needs a captured observable result; each skipped class needs a one-line not-applicable reason in the ledger.
- No implementation, review, or merge in the main checkout; every phase works in a task-owned worktree.
- No unprefixed session ids in Boulder state. Sessions are always recorded as \`codex:<session_id>\`.
- No stale-memory execution. The plan and ledger are the durable source of truth.
- Codex final verification is the exception to the delegated-QA-only rule above: perform your own manual QA on the real surface and record a self-review before completion.`;

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
const reviewWorkCodexGatePattern = new RegExp(reviewWorkCodexGate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

const ulwResearchOriginalDeliveryGates = "### The delivery gates \u2014 every gate must PASS, in order\n\nNothing reaches the user until the gates pass:\n\n1. **Visual QA (always).** Render the produced artifact back to images \u2014 PDF pages to PNG, the HTML in a real browser \u2014 and look at them: missing or broken figures, images stretched or spilling their containers, diagram or chart text rendered off the spec's font or palette, clipped tables, overflowing CJK text, blank pages, unlabeled chart values, wrong page breaks. Fix and re-render until the pages are clean. Reading the source markup is not visual QA; inspect the pixels.\n2. **Proofread gate \u2014 `task(category=\"writing\", ...)`.** Hand the final text to a dedicated `writing` worker whose only job is language: grammar, spelling, punctuation, terminology consistency, and whether the prose reads NATIVELY in the report's own language. It returns a defect list; fix every item and re-run the gate on the delta. Deliver only on a clean pass \u2014 this gate runs BEFORE the first delivery, not after the user finds the typo.";
const ulwResearchCodexDeliveryGate = "### The delivery gate \u2014 visual QA must PASS\n\nNothing reaches the user until the gate passes:\n\n**Visual QA (always).** Render the produced artifact back to images \u2014 PDF pages to PNG, the HTML in a real browser \u2014 and look at them: missing or broken figures, images stretched or spilling their containers, diagram or chart text rendered off the spec's font or palette, clipped tables, overflowing CJK text, blank pages, unlabeled chart values, wrong page breaks. Fix and re-render until the pages are clean. Reading the source markup is not visual QA; inspect the pixels.";

export function removeCodexSkillOverlays(skillName, content) {
	if (skillName === "ulw-research") {
		return content.replace(ulwResearchCodexDeliveryGate, ulwResearchOriginalDeliveryGates);
	}
	if (skillName === "ulw-execute") {
		return content
			.replace(ulwExecuteCodexCompletion, ulwExecuteOriginalCompletion)
			.replace(ulwExecuteCodexHardRule, ulwExecuteOriginalHardRule);
	}
	if (skillName === "review-work") {
		return content.replace(reviewWorkCodexGatePattern, "");
	}
	return content;
}

export async function listSkillFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		if (entry.isDirectory()) {
			const nested = await listSkillFiles(join(dir, entry.name));
			for (const nestedPath of nested) files.push(join(entry.name, nestedPath));
		} else {
			files.push(entry.name);
		}
	}
	return files.sort();
}

export function assertPackagedContentMatches({ path, content }, requirements) {
	for (const [label, pattern] of requirements) {
		assert.match(content, pattern, `${path} missing packaged skill contract: ${label}`);
	}
}
