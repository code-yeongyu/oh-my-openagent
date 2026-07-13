import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { root } from "./aggregate-plugin-fixture.mjs";

test("#given LazyCodex reviewer prompts #when inspected #then anti-slop review coverage is required", async () => {
	const agentsDir = join(root, "components", "ultrawork", "agents");
	const codeReviewer = await readFile(
		join(agentsDir, "lazycodex-code-reviewer.toml"),
		"utf8",
	);
	const gateReviewer = await readFile(
		join(agentsDir, "lazycodex-gate-reviewer.toml"),
		"utf8",
	);

	assert.match(codeReviewer, /remove-ai-slops/);
	assert.match(codeReviewer, /programming/);
	assert.match(codeReviewer, /load or consult/);
	assert.match(codeReviewer, /documented criteria/);
	assert.match(codeReviewer, /violates either skill perspective/);
	assert.match(codeReviewer, /overfit\/slop review pass/);
	assert.match(codeReviewer, /deletion-only tests/);
	assert.match(codeReviewer, /tests that merely verify a requested removal/);
	assert.match(codeReviewer, /tautological tests/);
	assert.match(codeReviewer, /mirror implementation constants/);
	assert.match(
		codeReviewer,
		/unnecessary production data extraction, parsing, or normalization/,
	);
	assert.match(codeReviewer, /false confidence/);

	assert.match(gateReviewer, /remove-ai-slops/);
	assert.match(gateReviewer, /programming/);
	assert.match(gateReviewer, /load or consult/);
	assert.match(gateReviewer, /documented criteria/);
	assert.match(gateReviewer, /Run the `remove-ai-slops`/);
	assert.match(gateReviewer, /Apply the `programming`/);
	assert.match(gateReviewer, /overfit\/slop pass yourself/);
	assert.match(gateReviewer, /tests that merely verify a requested removal/);
	assert.match(gateReviewer, /deletion-only/);
	assert.match(gateReviewer, /tautological/);
	assert.match(gateReviewer, /implementation-mirroring tests/);
	assert.match(
		gateReviewer,
		/unnecessary production extraction, parsing, or normalization/,
	);

	const directPassIndex = gateReviewer.indexOf("overfit/slop pass yourself");
	const reportCoverageIndex = gateReviewer.indexOf(
		"Then confirm the code review report",
	);
	assert.notEqual(directPassIndex, -1);
	assert.notEqual(reportCoverageIndex, -1);
	assert.ok(
		directPassIndex < reportCoverageIndex,
		"gate reviewer must perform the overfit/slop pass directly before checking report coverage",
	);
});

test("#given done-gate reviewer prompts #when inspected #then burden of proof is approve-unless-cited and reject priors are gone", async () => {
	const agentsDir = join(root, "components", "ultrawork", "agents");
	const gateReviewer = await readFile(
		join(agentsDir, "lazycodex-gate-reviewer.toml"),
		"utf8",
	);
	const qaExecutor = await readFile(
		join(agentsDir, "lazycodex-qa-executor.toml"),
		"utf8",
	);
	const codeReviewer = await readFile(
		join(agentsDir, "lazycodex-code-reviewer.toml"),
		"utf8",
	);

	assert.match(gateReviewer, /APPROVE unless you can cite/);
	assert.match(gateReviewer, /violatedCriterion/);
	assert.match(gateReviewer, /evidencePointer/);
	assert.match(gateReviewer, /top blockers inline/);
	assert.match(gateReviewer, /is a NOTE, not a blocker/);
	assert.match(gateReviewer, /You do NOT check/);
	assert.doesNotMatch(gateReviewer, /Assume the work has already failed/);
	assert.doesNotMatch(
		gateReviewer,
		/Return exactly one recommendation: APPROVE\/REJECT\./,
	);

	assert.match(qaExecutor, /one-line reason/);
	assert.match(
		qaExecutor,
		/rejecting a legitimately untriggered class is itself an error/,
	);
	assert.doesNotMatch(qaExecutor, /Trust nothing\./);

	assert.match(codeReviewer, /MEDIUM by default/);
	assert.doesNotMatch(
		codeReviewer,
		/Treat useless tests or needless production complexity as CRITICAL\/HIGH/,
	);
});
