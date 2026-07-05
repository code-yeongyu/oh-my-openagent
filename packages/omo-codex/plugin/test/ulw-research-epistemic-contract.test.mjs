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

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markdownSection(content, heading, nextHeading) {
	const headingPattern = new RegExp(`^${escapeRegExp(heading)}\\r?$`, "m");
	const headingMatch = content.match(headingPattern);
	assert.notEqual(headingMatch, null, `SKILL.md section not found: ${heading}`);
	assert.notEqual(headingMatch.index, undefined, `SKILL.md section index not found: ${heading}`);
	const bodyStart = headingMatch.index + headingMatch[0].length;
	if (nextHeading === undefined) return content.slice(bodyStart);
	const nextHeadingIndex = content.indexOf(`\n${nextHeading}`, bodyStart);
	assert.notEqual(nextHeadingIndex, -1, `SKILL.md next section not found: ${nextHeading}`);
	return content.slice(bodyStart, nextHeadingIndex);
}

test("#given ulw-research epistemic instrumentation #when the research contract is inspected #then the meta-layer artifacts and fields are required", async () => {
	for (const copy of await readUlwResearchCopies()) {
		const section = markdownSection(copy.content, "## Epistemic instrumentation", "## Run the swarm as a cooperating team");
		assert.match(section, /intent-diff\.md/i, `${copy.label}: body must require an intent-vs-reality diff artifact`);
		assert.match(section, /expected truth/i, `${copy.label}: intent diff must record expected truth`);
		assert.match(section, /observed reality/i, `${copy.label}: intent diff must record observed reality`);
		assert.match(section, /diff, violated invariant/i, `${copy.label}: intent diff must record the diff gap field and violated invariant`);
		assert.match(section, /claim-graph\.md/i, `${copy.label}: body must require a claim graph`);
		assert.match(section, /independent observation groups/i, `${copy.label}: claim graph must track independent observation groups`);
		assert.match(section, /convergence status/i, `${copy.label}: claim graph must track convergence status`);
		const claimGraphBullet = section.split("\n").find((line) => line.includes("`claim-graph.md`"));
		assert.notEqual(claimGraphBullet, undefined, `${copy.label}: claim graph bullet must exist`);
		assert.match(claimGraphBullet, /single claim store/i, `${copy.label}: claim graph must be the single claim store`);
		assert.match(claimGraphBullet, /risk tier/i, `${copy.label}: claim graph nodes must carry a risk tier`);
		assert.match(claimGraphBullet, /counter-search/i, `${copy.label}: claim graph nodes must carry the counter-search result`);
		assert.match(claimGraphBullet, /primary source/i, `${copy.label}: claim graph nodes must carry primary source backing`);
		assert.match(claimGraphBullet, /verified-claims/i, `${copy.label}: cleared nodes must feed the verified-claims digest`);
		assert.match(section, /observation-manifest\.md/i, `${copy.label}: body must require an observation manifest`);
		assert.match(section, /observer group/i, `${copy.label}: observation manifest must record observer groups`);
		assert.match(section, /independence basis/i, `${copy.label}: observation manifest must record independence basis`);
		assert.match(section, /observed_at/i, `${copy.label}: temporal evidence must include observed_at`);
		assert.match(section, /valid_at|claim_valid_at/i, `${copy.label}: temporal evidence must include a validity field`);
		assert.match(section, /verification-economics\.md/i, `${copy.label}: body must require verification economics`);
		assert.match(section, /cause-disappearance\.md/i, `${copy.label}: body must require cause-disappearance records`);
		assert.match(section, /last_seen/i, `${copy.label}: cause-disappearance records must track last_seen`);
		assert.match(section, /disconfirming observation/i, `${copy.label}: cause-disappearance records must track disconfirming observations`);
		assert.match(section, /no longer observed/i, `${copy.label}: cause-disappearance records must support no-longer-observed verdicts`);
	}
});

test("#given ulw-research readiness gates #when synthesis rules are inspected #then diff closure and independent convergence are required", async () => {
	for (const copy of await readUlwResearchCopies()) {
		const success = markdownSection(copy.content, "## Success criteria", "## Epistemic instrumentation");
		const phase4 = markdownSection(copy.content, "## Phase 4 — Synthesize", "## Phase 5 — Final materials");
		assert.match(success, /intent-vs-reality diff/i, `${copy.label}: success criteria must require intent diff closure`);
		assert.match(success, /independent observation groups/i, `${copy.label}: success criteria must require independent observations`);
		assert.match(success, /convergence/i, `${copy.label}: success criteria must require convergence`);
		assert.match(phase4, /intent-diff\.md/i, `${copy.label}: synthesis must start from the intent diff`);
		assert.match(phase4, /independent-observation convergence/i, `${copy.label}: synthesis must summarize independent convergence`);
	}
});

test("#given ulw-research observation instrumentation #when worker ownership is inspected #then workers return candidates as message text and the orchestrator writes manifests", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(copy.content, /observation candidates?|claim candidates?/i, `${copy.label}: workers must return claim and observation candidates`);
		assert.match(copy.content, /message text/i, `${copy.label}: claim and observation candidates must travel as message text`);
		assert.match(copy.content, /orchestrator-owned|orchestrator owns/i, `${copy.label}: instrumentation artifacts must be orchestrator-owned`);
		assert.doesNotMatch(
			copy.content,
			/worker[^.]*\b(?:write|append|create)s?\b[^.]*(?:intent-diff|observation-manifest|claim-graph|verification-economics|cause-disappearance)/i,
			`${copy.label}: workers must not write instrumentation artifacts directly`,
		);
	}
});

test("#given the claim graph as the single claim store #when the retired ledger is scanned #then claim-ledger is gone and the gate lives on graph nodes", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.doesNotMatch(copy.content, /claim[- ]ledger/i, `${copy.label}: the retired claim-ledger artifact must not appear`);
		const phase3b = markdownSection(copy.content, "## Phase 3b — Lock non-code claims through the claim graph", "## Phase 4 — Synthesize");
		assert.match(phase3b, /claim-graph\.md/i, `${copy.label}: the gate must record outcomes on claim-graph nodes`);
		assert.match(phase3b, /verified-claims/i, `${copy.label}: the verified-claims allowlist digest must survive the merge`);
		assert.match(phase3b, /sole allowlist/i, `${copy.label}: the data-flow-lock must stay self-enforcing`);
	}
});
