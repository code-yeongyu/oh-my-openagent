import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const CONTEXT_PRESSURE_SKILL_BUDGET_BYTES = 25_000;

export const expectedSkills = [
	"ast-grep",
	"coding-agent-sessions",
	"comment-checker",
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
	"start-work",
	"teammode",
	"ultimate-browsing",
	"ultrawork",
	"ulw-loop",
	"ulw-plan",
	"ulw-research",
	"visual-qa",
];

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
	["ultrawork", "components/ultrawork/skills/ultrawork"],
];

const codexCompatibilityEndMarkers = [
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

const startWorkOriginalCompletion = `When all top-level checkboxes in \`## TODOs\` and \`## Final Verification Wave\` are complete:

1. Run the plan's final verification commands.
2. For PR/branch work, finish the lifecycle from the task-owned worktree: sync \`.omo/\` state back to the main repo, create or update the PR, wait for review/verification gates, merge by default unless explicitly opted out, and remove the worktree only after successful merge or explicit handoff.
3. Remove or mark the Boulder work as completed.
4. Print an \`ORCHESTRATION COMPLETE\` block with the plan path, verification commands, artifacts, and cleanup receipts.`;

const startWorkCodexCompletion = `When all top-level checkboxes in \`## TODOs\` and \`## Final Verification Wave\` are complete:

1. Run the plan's final verification commands.
2. Complete the **Global Review and Debugging Gate** before any completion claim, PR creation, PR handoff, branch handoff, or merge:
   - Invoke the \`review-work\` skill with the final diff, changed files, user goal, constraints, run command, and verification evidence. All five review lanes must return PASS. A timeout, missing deliverable, ack-only child, \`BLOCKED:\`, or inconclusive lane is a gate failure, not approval.
   - Each passing review lane binds to the exact full commit SHA it reviewed. Immediately append a durable record to \`.omo/start-work/ledger.jsonl\` with the lane name, full SHA, PASS verdict, and report artifact/source. Before same-SHA reuse after any continuation or compaction, re-read the ledger record and require the exact lane/SHA pair; memory, chat history, or an unstamped report is not coverage. New commits require fresh applicable lane coverage.
   - Run a debugging-oriented runtime audit even when the review passes: name at least three plausible failure hypotheses for the changed surface, run the distinguishing checks against the actual artifact, and append a separate durable record with the audit name, exact full SHA, verdict, and evidence artifact/source to \`.omo/start-work/ledger.jsonl\`. Reuse it only after re-reading an exact audit/SHA match.
   - If any review lane or debugging hypothesis fails, invoke the \`debugging\` skill, confirm root cause with runtime evidence, add the minimal failing test or reproduction, fix it, rerun the affected verification, then rerun the Global Review and Debugging Gate.
   - Evidence hygiene is mandatory: redact or mask secrets and sensitive user data before writing \`.omo/start-work/ledger.jsonl\`, a PR body, or a handoff. Never include raw tokens, credentials, auth headers, cookies, API keys, env dumps, private logs, or PII; use concise summaries, lengths, hashes, or short non-sensitive prefixes instead.
   - If the work includes creating, updating, or handing off a PR, refresh \`git status\` and the PR/branch state from the task-owned worktree after the gate, and include only redacted review/debugging evidence in the PR body or handoff.
3. Finish the PR/branch lifecycle from its task-owned worktree: sync \`.omo/\` state back to the main repo, create or update the PR when requested, wait for CI/review/Cubic gates, merge by default unless explicitly opted out, and remove the worktree only after successful merge or explicit handoff.
4. Remove or mark the Boulder work as completed.
5. Print an \`ORCHESTRATION COMPLETE\` block with the plan path, verification commands, Global Review and Debugging Gate verdict, artifacts, and cleanup receipts.`;

const startWorkOriginalHardRule = "- No completion claim while an applicable ultraqa adversarial class was never probed. Each applicable class needs a captured observable result; each skipped class needs a one-line not-applicable reason in the ledger.\n- No PR/branch implementation, review, or merge in the main worktree; use the task-owned git worktree.\n- No unprefixed session ids in Boulder state. Codex sessions are always `codex:<session_id>`.";

const startWorkCodexHardRule = "- No completion claim while an applicable ultraqa adversarial class was never probed. Each applicable class needs a captured observable result; each skipped class needs a one-line not-applicable reason in the ledger.\n- No `ORCHESTRATION COMPLETE`, final response, PR creation, PR handoff, or merge before the Global Review and Debugging Gate passes with recorded evidence.\n- No PR/branch implementation or review in the main worktree; create or use a task-owned git worktree first.\n- No unprefixed session ids in Boulder state. Codex sessions are always `codex:<session_id>`.";

const reviewWorkCodexGate = `
When \`review-work\` is used as a final implementation, PR, or \`$start-work\`
gate, it is blocking. A timeout, missing deliverable, ack-only response,
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

export function removeCodexSkillOverlays(skillName, content) {
	if (skillName === "start-work") {
		return content
			.replace(startWorkCodexCompletion, startWorkOriginalCompletion)
			.replace(startWorkCodexHardRule, startWorkOriginalHardRule);
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
