// allow: SIZE_OK - ULW research skill contract tests inspect one bundled prompt protocol; this release introduces the contract and future additions should split by protocol phase.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function readUlwResearchCopies() {
	const sharedPath = join(sharedSkillsRootPath(), "ulw-research", "SKILL.md");
	const packagedPath = join(root, "skills", "ulw-research", "SKILL.md");
	return [
		{ label: "shared", path: sharedPath, content: await readFile(sharedPath, "utf8") },
		{ label: "packaged", path: packagedPath, content: await readFile(packagedPath, "utf8") },
	];
}

function frontmatterDescription(content) {
	const match = content.match(/^---\r?\n[\s\S]*?\bdescription:\s*"([\s\S]*?)"\r?\n[\s\S]*?---/);
	assert.notEqual(match, null, "SKILL.md frontmatter description not found");
	return match[1];
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markdownSection(content, heading, nextHeading) {
	const headingPattern = new RegExp(`^${escapeRegExp(heading)}\\r?$`, "m");
	const headingMatch = content.match(headingPattern);
	assert.notEqual(headingMatch, null, `SKILL.md section not found: ${heading}`);
	assert.notEqual(headingMatch.index, undefined, `SKILL.md section index not found: ${heading}`);
	const bodyStart = headingMatch.index + headingMatch[0].length;
	if (nextHeading === undefined) {
		return content.slice(bodyStart);
	}
	const nextHeadingIndex = content.indexOf(`\n${nextHeading}`, bodyStart);
	assert.notEqual(nextHeadingIndex, -1, `SKILL.md next section not found: ${nextHeading}`);
	return content.slice(bodyStart, nextHeadingIndex);
}

test("#given renamed research skill #when frontmatter is inspected #then ulw-research is the canonical name", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(copy.content, /^name: ulw-research$/m, `${copy.label}: frontmatter must expose ulw-research`);
	}
});

test("#given renamed research skill #when activation marker is inspected #then ulw-research is the canonical marker", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(
			copy.content,
			/`ULW-RESEARCH MODE ENABLED!`/,
			`${copy.label}: body must expose the ulw-research activation marker`,
		);
		assert.doesNotMatch(
			copy.content,
			/`ULTRARESEARCH MODE ENABLED!`/,
			`${copy.label}: body must not expose the old ultraresearch activation marker`,
		);
	}
});

test("#given ulw-research skill #when scanned for non-English content #then it contains no Hangul", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.doesNotMatch(
			copy.content,
			/[ᄀ-ᇿ㄰-㆏가-힣]/,
			`${copy.label} copy contains Hangul characters`,
		);
	}
});

test("#given ulw-research description #when activation policy is inspected #then it gates on explicit research demands only", async () => {
	for (const copy of await readUlwResearchCopies()) {
		const description = frontmatterDescription(copy.content);
		assert.match(description, /ulw-research/i, `${copy.label}: description must name the ulw-research trigger`);
		assert.match(description, /ultraresearch/i, `${copy.label}: description must preserve ultraresearch discoverability`);
		assert.match(description, /\bulw\b/i, `${copy.label}: description must preserve ulw discoverability`);
		assert.match(description, /explicit/i, `${copy.label}: description must gate activation on explicit demand`);
		assert.match(
			description,
			/ultra-precise investigation/i,
			`${copy.label}: description must name the ultra-precise investigation trigger`,
		);
		assert.match(description, /\bresearch\b/i, `${copy.label}: description must name the research trigger`);
	}
});

test("#given ulw-research body #when authority is inspected #then it takes precedence over exploration-bounding instructions", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(
			copy.content,
			/exploration-bounding|exploration (?:caps|budgets|limits)/i,
			`${copy.label}: body must name the exploration-bounding instructions it overrides`,
		);
		assert.match(
			copy.content,
			/supersede|override|do(?:es)? not (?:bind|apply)/i,
			`${copy.label}: body must state precedence while the mode is active`,
		);
	}
});

test("#given ulw-research worker protocol #when EXPAND flow is inspected #then markers travel as message text and workers never write files", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(copy.content, /EXPAND/, `${copy.label}: body must keep the EXPAND marker protocol`);
		assert.match(
			copy.content,
			/(?:reply|message|response) text|end (?:its|the|your) (?:reply|response|final message)/i,
			`${copy.label}: EXPAND markers must be returned as message text`,
		);
		assert.match(
			copy.content,
			/read-only|cannot write files|never ask (?:a )?worker(?:s)? to write/i,
			`${copy.label}: body must state the read-only worker constraint`,
		);
		assert.doesNotMatch(
			copy.content,
			/APPEND (?:your )?findings to \$SESSION_DIR/i,
			`${copy.label}: workers must not be instructed to append session-dir files`,
		);
	}
});

test("#given ulw-research journaling #when ownership is inspected #then the orchestrator owns the session journal", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(
			copy.content,
			/orchestrator[\s\S]{0,200}journal|journal[\s\S]{0,200}orchestrator/i,
			`${copy.label}: body must assign session-journal writes to the orchestrator`,
		);
		assert.match(copy.content, /SESSION_DIR/, `${copy.label}: body must keep the session directory protocol`);
	}
});

test("#given ulw-research expansion loop #when stop rules are inspected #then convergence rules and a depth cap are stated", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(copy.content, /converg/i, `${copy.label}: body must define convergence`);
		assert.match(copy.content, /depth/i, `${copy.label}: body must define an expansion depth cap`);
		assert.match(
			copy.content,
			/minimum (?:of )?(?:2|two) expansion waves|at least (?:2|two) expansion waves/i,
			`${copy.label}: body must require a minimum of two expansion waves before convergence`,
		);
	}
});

test("#given ulw-research under ultrawork #when coexistence is inspected #then marker and done-definition conflicts are resolved", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(copy.content, /ultrawork|\bulw\b/i, `${copy.label}: body must address ultrawork coexistence`);
		assert.match(
			copy.content,
			/first(?:-| )line/i,
			`${copy.label}: body must resolve the first-line activation marker conflict`,
		);
	}
});

test("#given ulw-research worker sizing #when spawn guidance is inspected #then capable-model and high-effort routing is stated", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(
			copy.content,
			/capable model|high(?:est)? (?:reasoning )?effort/i,
			`${copy.label}: body must route research workers to a capable model or high effort`,
		);
	}
});

test("#given ulw-research execution substrate #when team usage is inspected #then it prefers a cooperating team with harness-native team tools", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(
			copy.content,
			/cooperating team/i,
			`${copy.label}: body must encourage running the swarm as a cooperating team`,
		);
		assert.match(copy.content, /\bteammode\b/i, `${copy.label}: body must name the Codex teammode skill`);
		assert.match(copy.content, /team_mode/i, `${copy.label}: body must name the OpenCode team_mode path`);
	}
});

test("#given ulw-research team composition #when member slicing is inspected #then members map to part/ownership/perspective, never job titles", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(
			copy.content,
			/by part, ownership, or perspective/i,
			`${copy.label}: body must compose members by part, ownership, or perspective`,
		);
		assert.match(
			copy.content,
			/never a job title|not (?:a |by )?job title/i,
			`${copy.label}: body must forbid vague job-title members`,
		);
	}
});

test("#given ulw-research team communication #when the raise law is inspected #then members broadcast every lead immediately rather than hoarding", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(
			copy.content,
			/raise law|broadcast every lead/i,
			`${copy.label}: body must state the raise/broadcast law`,
		);
		assert.match(copy.content, /over-communicate/i, `${copy.label}: body must demand over-communication`);
		assert.match(
			copy.content,
			/the (?:moment|instant) it (?:surfaces|appears|lands)/i,
			`${copy.label}: body must require raising leads the moment they surface`,
		);
		assert.match(
			copy.content,
			/hoard/i,
			`${copy.label}: body must reject hoarding leads for a final dump`,
		);
	}
});

test("#given ulw-research default swarm #when team guidance is inspected #then teammode, many teammates, and hyperdebate are defaulted", async () => {
	for (const copy of await readUlwResearchCopies()) {
		const teamSection = markdownSection(copy.content, "## Run the swarm as a cooperating team", "## Worker ground rules");
		assert.match(teamSection, /default(?:s)? to teammode|teammode by default/i, `${copy.label}: teammode must be the default`);
		assert.match(teamSection, /many teammates|larger roster|5-8 teammates|5\+ teammates/i, `${copy.label}: body must prefer many teammates`);
		assert.match(teamSection, /hyperdebate|ultradebate/i, `${copy.label}: body must require adversarial debate`);
		assert.match(teamSection, /skeptic|red-team|cross-critique/i, `${copy.label}: body must include a critique perspective`);
	}
});

test("#given ulw-research non-code verification #when the gate is inspected #then a claim ledger / verified-claims data-flow-lock exists", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(
			copy.content,
			/claim ledger|verified-claims/i,
			`${copy.label}: body must define the non-code claim-ledger verification gate`,
		);
	}
});

test("#given ulw-research claim ledger #when ownership is inspected #then workers never write the ledger / verified-claims artifact", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.doesNotMatch(
			copy.content,
			/worker[^.]*\b(?:write|append|create)s?\b[^.]*(?:ledger|verified-claims)/i,
			`${copy.label}: workers must not be instructed to write/append/create the ledger or verified-claims`,
		);
	}
});

test("#given ulw-research report output #when defaults are inspected #then HTML/PDF reports go through frontend, visual QA, and reviewer approval", async () => {
	for (const copy of await readUlwResearchCopies()) {
		const phase0 = markdownSection(copy.content, "## Phase 0 — Decompose and open the journal", "## Phase 1 — Saturation wave");
		const phase4 = markdownSection(copy.content, "## Phase 4 — Synthesize", "## Phase 5 — Final materials");
		const phase5 = markdownSection(copy.content, "## Phase 5 — Final materials", "## Search craft");
		assert.match(phase0, /Final material format:\s*<HTML\/PDF default \| explicit format \| markdown only>/, `${copy.label}: Phase 0 must track the default final-material contract`);
		assert.match(phase4, /citation source of truth/i, `${copy.label}: Phase 4 synthesis must be a source of truth, not the default final artifact`);
		assert.doesNotMatch(phase4, /When no report was requested, this is the deliverable/i, `${copy.label}: Phase 4 must not contradict default HTML/PDF final materials`);
		assert.match(phase5, /Default final materials to HTML\/PDF unless the user explicitly asks/i, `${copy.label}: Phase 5 must default final materials to HTML/PDF`);
		assert.match(phase5, /HTML first[\s\S]{0,120}PDF default/i, `${copy.label}: report output must default to HTML with PDF availability`);
		assert.match(phase5, /\bfrontend\b/i, `${copy.label}: report assembly must load the frontend skill`);
		assert.match(phase5, /visual-qa/i, `${copy.label}: report assembly must require visual-qa`);
		assert.match(phase5, /ulw-loop|ULW loop/i, `${copy.label}: report QA must run under the ULW loop`);
		assert.match(phase5, /reviewer[\s\S]{0,120}(?:approve|says no broken parts|no broken parts)/i, `${copy.label}: report completion must wait for reviewer approval`);
	}
});

test("#given ulw-research final materials #when visual artifact guidance is inspected #then charts Mermaid graphs and imagegen are strongly required", async () => {
	for (const copy of await readUlwResearchCopies()) {
		const phase5 = markdownSection(copy.content, "## Phase 5 — Final materials", "## Search craft");
		assert.match(phase5, /actively use charts/i, `${copy.label}: reports must strongly require charts`);
		assert.match(phase5, /Mermaid graphs/i, `${copy.label}: reports must require Mermaid graphs`);
		assert.match(phase5, /imagegen skill/i, `${copy.label}: reports must require imagegen visuals`);
		assert.match(phase5, /generated (?:diagrams|visuals)|generated diagrams or editorial visuals/i, `${copy.label}: report assets must include generated visual guidance`);
	}
});

test("#given ulw-research blocked sources #when escalation is inspected #then it routes through the ultimate-browsing skill", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(
			copy.content,
			/ultimate-browsing/,
			`${copy.label}: body must escalate blocked sources via the ultimate-browsing skill`,
		);
	}
});
