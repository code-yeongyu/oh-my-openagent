import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const skillPath = join(root, "skills", "ulw-plan", "SKILL.md");
const workflowPath = join(root, "skills", "ulw-plan", "references", "full-workflow.md");
const opencodeOnlyToolPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/;

test("#given ulw-plan skill #when inspected #then it is a Codex-native planner that defers the deep workflow to its reference", async () => {
	// given
	const skill = await readFile(skillPath, "utf8");

	// then
	assert.match(skill, /^---\r?\nname: ulw-plan\r?\n/m);
	assert.match(skill, /references\/full-workflow\.md/);
	assert.match(skill, /multi_agent_v1\.spawn_agent\(\{[^)]*"fork_context":false/);
	assert.doesNotMatch(skill, opencodeOnlyToolPattern);
});

test("#given ulw-plan skill #when the planning gate is inspected #then it explores first and waits for explicit user approval instead of auto-transitioning", async () => {
	// given
	const skill = await readFile(skillPath, "utf8");

	// then
	assert.match(skill, /explore/i);
	assert.match(skill, /wait for[^.]{0,80}explicit[^.]{0,40}(?:okay|approval)/i);
	assert.doesNotMatch(skill, /Proceeding to plan generation/);
});

test("#given ulw-plan skill #when the execution gate is inspected #then plan mode is sticky, execution needs an explicit start, and the high-accuracy ask is mandatory", async () => {
	// given
	const skill = await readFile(skillPath, "utf8");

	// then
	assert.match(skill, /plan mode is sticky/i);
	assert.match(skill, /never\s+(?:start|begin)[^.]{0,80}(?:implement|execut)/i);
	assert.match(skill, /ask[^.]{0,160}high[- ]accuracy/i);
	assert.match(skill, /two filters/i);
	assert.match(skill, /\bWHY\b/);
});

test("#given ulw-plan full workflow reference #when the delivery phase is inspected #then it mandates the start-or-high-accuracy question and forbids self-started execution", async () => {
	// given
	const workflow = await readFile(workflowPath, "utf8");

	// then
	assert.match(workflow, /plan mode is sticky/i);
	assert.match(workflow, /two filters/i);
	assert.match(workflow, /ask[^.]{0,160}high[- ]accuracy/i);
	assert.match(workflow, /execution belongs to the worker/i);
	assert.doesNotMatch(workflow, /High-accuracy review \(optional\)/);
});

test("#given ulw-plan full workflow reference #when inspected #then it documents the approval gate and .omo plan output with Codex-native tools only", async () => {
	// given
	const workflow = await readFile(workflowPath, "utf8");

	// then
	assert.match(workflow, /\.omo\/plans\/<slug>\.md/);
	assert.match(workflow, /[Aa]pproval gate/);
	assert.match(workflow, /multi_agent_v1\.spawn_agent\(\{[^)]*"fork_context":false/);
	assert.doesNotMatch(workflow, opencodeOnlyToolPattern);
	assert.doesNotMatch(workflow, /Proceeding to plan generation/);
});

test("#given ulw-plan approval gate #when inspected #then it is a durable decision rule that ends the approval loop (lazycodex #48)", async () => {
	// given
	const skill = await readFile(skillPath, "utf8");
	const workflow = await readFile(workflowPath, "utf8");
	const combined = `${skill}\n${workflow}`;

	// then — a durable approval-pending checkpoint guards against re-running exploration after compaction
	assert.match(combined, /awaiting-approval/);
	assert.match(combined, /instead of re-running exploration/i);

	// then — approval is decided from intent, not a fixed passphrase
	assert.match(combined, /"proceed"/);
	assert.match(combined, /"write the plan"/);

	// then — approval authorizes writing the plan, never implementation (resolves sticky-mode ambiguity)
	assert.match(combined, /authoriz[^.]{0,80}writing the plan/i);
	assert.match(combined, /never authorization to implement/i);

	// then — the still-unclear path is a single prompt, never a re-exploration loop
	assert.match(combined, /do not re-explore/i);
});

test("#given ulw-plan skill #when intent routing is inspected #then it splits clear vs unclear into two references with the on-the-fence tie-break", async () => {
	// given
	const skill = await readFile(skillPath, "utf8");

	// then — one judgment, one reference; the tie-break defends against silently mis-routing CLEAR to UNCLEAR
	assert.match(skill, /references\/intent-clear\.md/);
	assert.match(skill, /references\/intent-unclear\.md/);
	assert.match(skill, /on the fence/i);
	assert.match(skill, /treat it as CLEAR/i);
});

test("#given ulw-plan skill #when the generator mandate is inspected #then it runs the cross-platform scaffold script and appends, never hand-building", async () => {
	// given
	const skill = await readFile(skillPath, "utf8");

	// then
	assert.match(skill, /scaffold-plan\.mjs/);
	assert.match(skill, /APPEND[^.]{0,80}Todos/);
	assert.match(skill, /never rewrite[^.]{0,40}headers/i);
	assert.match(skill, /## TL;DR \(For humans\)/);
});

test("#given the unclear-intent reference #when inspected #then it forbids interrogation, auto-runs high accuracy, and suppresses it on Trivial", async () => {
	// given
	const unclear = await readFile(join(root, "skills", "ulw-plan", "references", "intent-unclear.md"), "utf8");

	// then — when the human cannot steer, research + announced defaults replace the interview, and adversarial review substitutes for it
	assert.match(unclear, /do NOT interrogate/);
	assert.match(unclear, /announce/i);
	assert.match(unclear, /AUTOMATICALLY/);
	assert.match(unclear, /Trivial[^.]{0,80}SUPPRESS/i);

	// then — the reference is an agent-facing prose file too, so it must stay Codex-native (no opencode-only tools leak)
	assert.doesNotMatch(unclear, opencodeOnlyToolPattern);
});

test("#given the clear-intent reference #when inspected #then it asks the surviving forks with WHY and keeps Momus optional", async () => {
	// given
	const clear = await readFile(join(root, "skills", "ulw-plan", "references", "intent-clear.md"), "utf8");

	// then
	assert.match(clear, /ASK WITH WHY/);
	assert.match(clear, /two filters/i);
	assert.match(clear, /never automatic/i);
	assert.doesNotMatch(clear, opencodeOnlyToolPattern);
});

test("#given the plan template in full-workflow #when inspected #then the human TL;DR leads above the AI detail and the script is the source", async () => {
	// given
	const workflow = await readFile(workflowPath, "utf8");

	// then — the documented template, not just the emitted skeleton, must keep the human TL;DR above the AI detail
	assert.match(workflow, /## TL;DR \(For humans\)/);
	assert.match(workflow, /scaffold-plan\.mjs/);
	assert.ok(workflow.indexOf("## TL;DR (For humans)") < workflow.indexOf("## Scope"));
	// then — the HR6 hand-build backstop is regression-locked, not just prose that a future shrink can drop
	assert.match(workflow, /HR6 backstop/i);
});

test("#given the high-accuracy review #when inspected #then it is a dual Momus where both passes must return OKAY", async () => {
	// given
	const workflow = await readFile(workflowPath, "utf8");

	// then — every Momus plan review runs twice (native momus + codex-CLI gpt-5.5 xhigh); both must approve before handoff
	assert.match(workflow, /dual/i);
	assert.match(workflow, /momus/i);
	assert.match(workflow, /gpt-5\.5/);
	assert.match(workflow, /both[^.]{0,40}OKAY/i);
});
