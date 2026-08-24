import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sharedRoot = sharedSkillsRootPath();

async function readSkillCopy(label, path) {
	return { label, path, content: await readFile(path, "utf8") };
}

async function readSharedAndPackagedSkill(skillName) {
	return [
		await readSkillCopy(`shared:${skillName}`, join(sharedRoot, skillName, "SKILL.md")),
		await readSkillCopy(`packaged:${skillName}`, join(pluginRoot, "skills", skillName, "SKILL.md")),
	];
}

function assertGeneralEpistemicGate(copy) {
	assert.match(copy.content, /epistemic workflow/i, `${copy.label}: missing general epistemic workflow gate`);
	assert.match(copy.content, /expected truth/i, `${copy.label}: missing expected-truth discipline`);
	assert.match(copy.content, /observed reality/i, `${copy.label}: missing observed-reality discipline`);
	assert.match(copy.content, /independent (?:observation|evidence|verification|review)/i, `${copy.label}: missing independent observation discipline`);
	assert.match(copy.content, /verification economics/i, `${copy.label}: missing verification economics`);
	assert.match(copy.content, /cause disappearance/i, `${copy.label}: missing cause-disappearance closeout`);
	assert.match(copy.content, /baseline characterization|failing-first proof|real-surface proof|runtime truth/i, `${copy.label}: missing observable proof before done`);
}

function assertWorkflowArtifactVocabulary(copy) {
	assert.match(copy.content, /epistemic (?:workflow|instrumentation)/i, `${copy.label}: missing epistemic workflow vocabulary`);
	assert.match(copy.content, /claim[- ]graph/i, `${copy.label}: missing claim-graph vocabulary`);
	assert.match(copy.content, /observation[- ]manifest/i, `${copy.label}: missing observation-manifest vocabulary`);
	assert.match(copy.content, /verification[- ]economics/i, `${copy.label}: missing verification-economics vocabulary`);
	assert.match(copy.content, /cause[- ]disappearance/i, `${copy.label}: missing cause-disappearance vocabulary`);
}

test("#given core workflow skills #when inspected #then the PR 5812 epistemic workflow is generalized beyond ulw-research", async () => {
	const skillNames = [
		"programming",
		"refactor",
		"remove-ai-slops",
		"review-work",
		"start-work",
		"debugging",
	];

	for (const skillName of skillNames) {
		for (const copy of await readSharedAndPackagedSkill(skillName)) {
			assertGeneralEpistemicGate(copy);
		}
	}
});

test("#given planning and execution workflows #when inspected #then they carry the shared epistemic artifact vocabulary", async () => {
	const workflowCopies = [
		await readSkillCopy("shared:ulw-plan/SKILL.md", join(sharedRoot, "ulw-plan", "SKILL.md")),
		await readSkillCopy("shared:ulw-plan/full-workflow.md", join(sharedRoot, "ulw-plan", "references", "full-workflow.md")),
		await readSkillCopy("shared:ulw-plan/scaffold-plan.mjs", join(sharedRoot, "ulw-plan", "scripts", "scaffold-plan.mjs")),
		await readSkillCopy(
			"component:ulw-plan/SKILL.md",
			join(pluginRoot, "components", "ultrawork", "skills", "ulw-plan", "SKILL.md"),
		),
		await readSkillCopy(
			"component:ulw-plan/full-workflow.md",
			join(pluginRoot, "components", "ultrawork", "skills", "ulw-plan", "references", "full-workflow.md"),
		),
		await readSkillCopy(
			"component:ulw-plan/scaffold-plan.mjs",
			join(pluginRoot, "components", "ultrawork", "skills", "ulw-plan", "scripts", "scaffold-plan.mjs"),
		),
		await readSkillCopy("packaged:ulw-plan/SKILL.md", join(pluginRoot, "skills", "ulw-plan", "SKILL.md")),
		await readSkillCopy("packaged:ulw-plan/full-workflow.md", join(pluginRoot, "skills", "ulw-plan", "references", "full-workflow.md")),
		await readSkillCopy("packaged:ulw-plan/scaffold-plan.mjs", join(pluginRoot, "skills", "ulw-plan", "scripts", "scaffold-plan.mjs")),
		await readSkillCopy(
			"component:ulw-loop/full-workflow.md",
			join(pluginRoot, "components", "ulw-loop", "skills", "ulw-loop", "references", "full-workflow.md"),
		),
		await readSkillCopy("packaged:ulw-loop/full-workflow.md", join(pluginRoot, "skills", "ulw-loop", "references", "full-workflow.md")),
	];

	for (const copy of workflowCopies) {
		assertWorkflowArtifactVocabulary(copy);
	}
});
