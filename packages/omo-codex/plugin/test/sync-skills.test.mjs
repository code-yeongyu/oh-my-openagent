import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	componentSkillSources,
	expectedSkills,
	listSkillFiles,
	removeCodexCompatibilityGuidance,
} from "./sync-skills-test-support.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(root, "..", "..", "..");
async function assertNoLegacyResearchAliasInTree(rootDir, label) {
	for (const file of await listSkillFiles(rootDir)) {
		const content = await readFile(join(rootDir, file), "utf8");
		assert.doesNotMatch(
			content,
			/ultraresearch/i,
			`${label}/${file} must not expose ultraresearch`,
		);
	}
}

test("#given synced aggregate Codex skills #when inspected #then component and shared skills are present", async () => {
	// given
	const skillsRoot = join(root, "skills");

	// when
	const skillNames = (await readdir(skillsRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	// then
	assert.deepEqual(skillNames, expectedSkills);
	for (const skillName of expectedSkills) {
		const content = await readFile(
			join(skillsRoot, skillName, "SKILL.md"),
			"utf8",
		);
		assert.match(removeCodexCompatibilityGuidance(content), /^---\r?\n/);
	}
});

test("#given reference-only designpowers frontend files #when synced for Codex #then nested SKILL.md files are not packaged", async () => {
	// given
	const frontendReferencesRoot = join(root, "skills", "frontend", "references");
	const designpowersVendorSkillsRoot = join(
		frontendReferencesRoot,
		"designpowers",
		"vendor",
		"skills",
	);

	// when
	const nestedSkillFiles = (await listSkillFiles(frontendReferencesRoot))
		.map((file) => file.replaceAll("\\", "/"))
		.filter((file) => file.endsWith("/SKILL.md") || file === "SKILL.md")
		.sort();
	const designpowersReferenceFiles = (
		await listSkillFiles(designpowersVendorSkillsRoot)
	)
		.map((file) => file.replaceAll("\\", "/"))
		.filter((file) => file.endsWith("/reference.md"))
		.sort();

	// then
	assert.deepEqual(nestedSkillFiles, []);
	assert.equal(designpowersReferenceFiles.length, 27);
});

test("#given aggregate Codex skills #when source wiring is inspected #then shared skills are imported from the shared-skills package", async () => {
	// given
	const pluginPackageJson = JSON.parse(
		await readFile(join(root, "package.json"), "utf8"),
	);
	const sharedPackageJson = JSON.parse(
		await readFile(
			join(root, "..", "..", "shared-skills", "package.json"),
			"utf8",
		),
	);
	const rootPackageJson = JSON.parse(
		await readFile(join(repoRoot, "package.json"), "utf8"),
	);
	const syncScript = await readFile(
		join(root, "scripts", "sync-skills.mjs"),
		"utf8",
	);

	// when
	const sharedSkillDependency =
		pluginPackageJson.dependencies?.["@oh-my-opencode/shared-skills"];
	const rootPackageFiles = rootPackageJson.files ?? [];

	// then
	assert.deepEqual(sharedPackageJson.exports?.["."], {
		types: "./index.d.ts",
		import: "./index.mjs",
	});
	assert.equal(sharedPackageJson.files?.includes("skills"), true);
	assert.equal(
		rootPackageFiles.includes("packages/shared-skills/package.json"),
		true,
	);
	assert.equal(
		rootPackageFiles.includes("packages/shared-skills/index.mjs"),
		true,
	);
	assert.equal(
		rootPackageFiles.includes("packages/shared-skills/skills"),
		true,
	);
	assert.equal(sharedSkillDependency, "file:../../shared-skills");
	assert.match(syncScript, /from "@oh-my-opencode\/shared-skills"/);
	assert.doesNotMatch(syncScript, /shared-skills",\s*"skills"/);
});

test("#given shared skill source tests #when aggregate Codex skills are synced #then source tests are not packaged", async () => {
	// given
	const aggregateSkillsRoot = join(root, "skills");

	// when
	const forbiddenFiles = [];
	for (const skillName of expectedSkills) {
		for (const file of await listSkillFiles(
			join(aggregateSkillsRoot, skillName),
		)) {
			const normalized = file.replaceAll("\\", "/");
			const segments = normalized.split("/");
			const scriptsIndex = segments.lastIndexOf("scripts");
			const hasPythonTestDir =
				scriptsIndex !== -1 && segments[scriptsIndex + 1] === "tests";
			const isSourceMetadata =
				normalized === ".gitignore" ||
				normalized === ".npmignore" ||
				normalized === "pyrightconfig.json";
			if (
				normalized.endsWith(".test.ts") ||
				hasPythonTestDir ||
				segments.includes("__pycache__") ||
				normalized.endsWith(".pyc") ||
				isSourceMetadata
			) {
				forbiddenFiles.push(`${skillName}/${normalized}`);
			}
		}
	}

	// then
	assert.deepEqual(forbiddenFiles, []);
});

test("#given shipped Codex skill payloads #when legacy ultraresearch alias is inspected #then it is not packaged", async () => {
	// given
	const skillsRoot = join(root, "skills");
	const skillRoot = join(skillsRoot, "ultraresearch");

	// then
	await assert.rejects(readFile(join(skillRoot, "SKILL.md"), "utf8"), {
		code: "ENOENT",
	});
	await assert.rejects(
		readFile(join(skillRoot, "agents", "openai.yaml"), "utf8"),
		{ code: "ENOENT" },
	);
	await assertNoLegacyResearchAliasInTree(skillsRoot, "skills");
	for (const [skillName, sourcePath] of componentSkillSources) {
		await assertNoLegacyResearchAliasInTree(
			join(root, sourcePath),
			`components/${skillName}`,
		);
	}
});
