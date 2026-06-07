import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(dirname(pluginRoot)));
const startWorkSkillPaths = [
	join(repoRoot, "packages", "shared-skills", "skills", "start-work", "SKILL.md"),
];
const packagedStartWorkSkillPath = join(pluginRoot, "skills", "start-work", "SKILL.md");
const packagedReviewWorkSkillPath = join(pluginRoot, "skills", "review-work", "SKILL.md");
const hephaestusRulePath = join(pluginRoot, "components", "rules", "bundled-rules", "hephaestus.md");
const stopHookPath = join(
	pluginRoot,
	"components",
	"start-work-continuation",
	"src",
	"codex-hook.ts",
);

test("#given start-work skill without selectable plan #when inspected #then bootstraps ulw-plan before execution", async () => {
	// given
	const missing = [];

	// when
	for (const skillPath of startWorkSkillPaths) {
		const skill = await readFile(skillPath, "utf8");
		if (
			!/(?:no|zero)[^.]{0,120}(?:selectable|matching|existing|prometheus)?[^.]{0,120}plans?[^.]{0,160}(?:\$?ulw-plan|ulw-plan skill|spawn_agent\([^)]*ulw-plan)/is.test(
				skill,
			) ||
			!/(?:bootstrap|create|generate|draft)[^.]{0,120}(?:plan|prometheus plan)[^.]{0,120}(?:before|prior to)[^.]{0,80}(?:execution|implementation|boulder)/is.test(
				skill,
			)
		) {
			missing.push(skillPath);
		}
	}

	// then
	assert.deepEqual(missing, []);
});

test("#given worker done claim #when start-work contract is inspected #then adversarial verification gates fully done", async () => {
	// given
	const missing = [];

	// when
	for (const skillPath of startWorkSkillPaths) {
		const skill = await readFile(skillPath, "utf8");
		if (
			!/DoneClaim/i.test(skill) ||
			!/worker done claim/i.test(skill) ||
			!/stale_state/.test(skill) ||
			!/misleading_success_output/.test(skill) ||
			!/dirty_worktree/.test(skill) ||
			!/Plan reread/i.test(skill) ||
			!/Manual-QA/i.test(skill) ||
			!/Adversarial QA/i.test(skill) ||
			!/Cleanup/i.test(skill) ||
			!/Only after verification passes/i.test(skill)
		) {
			missing.push(skillPath);
		}
	}

	// then
	assert.deepEqual(missing, []);
});

test("#given packaged start-work completion surfaces #when inspected #then global review and debugging gate blocks completion", async () => {
	// given
	const [startWorkSkill, reviewWorkSkill, hephaestusRule] = await Promise.all([
		readFile(packagedStartWorkSkillPath, "utf8"),
		readFile(packagedReviewWorkSkillPath, "utf8"),
		readFile(hephaestusRulePath, "utf8"),
	]);

	// then
	assert.match(startWorkSkill, /Global Review and Debugging Gate/);
	assert.match(startWorkSkill, /\breview-work\b/);
	assert.match(startWorkSkill, /\bdebugging\b/);
	assert.match(startWorkSkill, /inconclusive/i);
	assert.match(startWorkSkill, /redact|mask/i);
	assert.match(startWorkSkill, /raw (?:tokens|credentials|auth headers|cookies)/i);
	assert.match(startWorkSkill, /ORCHESTRATION COMPLETE/);
	assert.match(reviewWorkSkill, /debugging/i);
	assert.match(reviewWorkSkill, /inconclusive/i);
	assert.match(hephaestusRule, /Global Review and Debugging Gate/);
	assert.match(hephaestusRule, /redact.*secrets.*PII/s);
});

test("#given start-work continuation hook #when inspected #then it remains Boulder-only without planning bootstrap logic", async () => {
	// given
	const hook = await readFile(stopHookPath, "utf8");

	// then
	assert.match(hook, /readContinuationState/);
	assert.match(hook, /START_WORK_CONTINUATION_DIRECTIVE/);
	assert.match(hook, /decision:\s*"block"/);
	assert.doesNotMatch(
		hook,
		/\bulw-plan\b|\bspawn_agent\b|\brequest_user_input\b|bootstrap|selectable plan|Phase 1|Create or update Boulder state/i,
	);
});
