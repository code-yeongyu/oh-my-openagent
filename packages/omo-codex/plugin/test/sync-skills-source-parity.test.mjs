import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills";
import {
	componentSkillSources,
	hiddenSharedSkills,
	listSkillFiles,
	removeCodexCompatibilityGuidance,
	removeCodexSkillOverlays,
} from "./sync-skills-test-support.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const generatedSkillMetadataFiles = new Set(["agents/openai.yaml"]);

function excludeGeneratedSkillMetadata(files) {
	return files.filter(
		(file) => !generatedSkillMetadataFiles.has(file.replaceAll("\\", "/")),
	);
}

test("#given shared skill package source #when aggregate Codex shared skills are inspected #then generated copies have no hand-authored drift", async () => {
	// given
	const sharedSkillsRoot = sharedSkillsRootPath();
	const aggregateSkillsRoot = join(root, "skills");
	const componentSkillNames = new Set(
		componentSkillSources.map(([skillName]) => skillName),
	);
	const sharedSkillNames = (
		await readdir(sharedSkillsRoot, { withFileTypes: true })
	)
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	// when / then
	for (const skillName of sharedSkillNames) {
		if (componentSkillNames.has(skillName)) continue;
		if (hiddenSharedSkills.includes(skillName)) continue;
		const sharedContent = await readFile(
			join(sharedSkillsRoot, skillName, "SKILL.md"),
			"utf8",
		);
		const aggregateContent = await readFile(
			join(aggregateSkillsRoot, skillName, "SKILL.md"),
			"utf8",
		);
		assert.equal(
			removeCodexSkillOverlays(
				skillName,
				removeCodexCompatibilityGuidance(aggregateContent),
			),
			removeCodexCompatibilityGuidance(sharedContent),
			`${skillName} drifted from shared-skills`,
		);
	}
});

test("#given a shared skill name collides with a Codex component skill #when aggregate skills are inspected #then the component skill wins", async () => {
	// given
	const sharedSkill = await readFile(
		join(sharedSkillsRootPath(), "ulw-plan", "SKILL.md"),
		"utf8",
	);
	const componentSkill = await readFile(
		join(root, "components", "ultrawork", "skills", "ulw-plan", "SKILL.md"),
		"utf8",
	);
	const aggregateSkill = await readFile(
		join(root, "skills", "ulw-plan", "SKILL.md"),
		"utf8",
	);

	// when / then
	assert.notEqual(
		removeCodexCompatibilityGuidance(aggregateSkill),
		removeCodexCompatibilityGuidance(sharedSkill),
	);
	assert.equal(
		removeCodexCompatibilityGuidance(aggregateSkill),
		removeCodexCompatibilityGuidance(componentSkill),
	);
	assert.match(aggregateSkill, /multi_agent_v1/);
});

test("#given component skill sources #when aggregate Codex component skills are inspected #then generated copies have no hand-authored drift", async () => {
	// given
	const aggregateSkillsRoot = join(root, "skills");

	// when / then
	for (const [skillName, sourcePath] of componentSkillSources) {
		const sourceDir = join(root, sourcePath);
		const aggregateDir = join(aggregateSkillsRoot, skillName);
		const sourceFiles = excludeGeneratedSkillMetadata(
			await listSkillFiles(sourceDir),
		);
		const aggregateFiles = excludeGeneratedSkillMetadata(
			await listSkillFiles(aggregateDir),
		);
		assert.deepEqual(
			aggregateFiles,
			sourceFiles,
			`${skillName} resource set drifted from its component skill source`,
		);
		for (const relativePath of sourceFiles) {
			const sourceContent = await readFile(
				join(sourceDir, relativePath),
				"utf8",
			);
			const aggregateContent = await readFile(
				join(aggregateDir, relativePath),
				"utf8",
			);
			assert.equal(
				removeCodexSkillOverlays(
					skillName,
					removeCodexCompatibilityGuidance(aggregateContent),
				),
				removeCodexCompatibilityGuidance(sourceContent),
				`${skillName}/${relativePath} drifted from its component skill source`,
			);
		}
	}
});
