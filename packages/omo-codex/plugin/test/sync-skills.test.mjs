import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills";
import {
	canonicalUltraworkDirectiveRelativePath,
	componentSkillSources,
	expectedSkills,
	listSkillFiles,
	removeCodexCompatibilityGuidance,
	removeCodexSkillOverlays,
} from "./sync-skills-test-support.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(root, "..", "..", "..");
const generatedSkillMetadataFiles = new Set(["agents/openai.yaml"]);

async function readPackagedSkillFile(...segments) {
	const path = join(root, "skills", ...segments);
	const content = await readFile(path, "utf8");
	return { path, content };
}

function excludeGeneratedSkillMetadata(files) {
	return files.filter((file) => !generatedSkillMetadataFiles.has(file.replaceAll("\\", "/")));
}

async function assertNoLegacyResearchAliasInTree(rootDir, label) {
	for (const file of await listSkillFiles(rootDir)) {
		const content = await readFile(join(rootDir, file), "utf8");
		assert.doesNotMatch(content, /ultraresearch/i, `${label}/${file} must not expose ultraresearch`);
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
		const content = await readFile(join(skillsRoot, skillName, "SKILL.md"), "utf8");
		assert.match(removeCodexCompatibilityGuidance(content), /^---\r?\n/);
	}
});

test("#given reference-only designpowers frontend files #when synced for Codex #then nested SKILL.md files are not packaged", async () => {
	// given
	const frontendReferencesRoot = join(root, "skills", "frontend", "references");
	const designpowersVendorSkillsRoot = join(frontendReferencesRoot, "designpowers", "vendor", "skills");

	// when
	const nestedSkillFiles = (await listSkillFiles(frontendReferencesRoot))
		.map((file) => file.replaceAll("\\", "/"))
		.filter((file) => file.endsWith("/SKILL.md") || file === "SKILL.md")
		.sort();
	const designpowersReferenceFiles = (await listSkillFiles(designpowersVendorSkillsRoot))
		.map((file) => file.replaceAll("\\", "/"))
		.filter((file) => file.endsWith("/reference.md"))
		.sort();

	// then
	assert.deepEqual(nestedSkillFiles, []);
	assert.equal(designpowersReferenceFiles.length, 27);
});

test("#given aggregate Codex skills #when source wiring is inspected #then shared skills are imported from the shared-skills package", async () => {
	// given
	const pluginPackageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
	const sharedPackageJson = JSON.parse(await readFile(join(root, "..", "..", "shared-skills", "package.json"), "utf8"));
	const rootPackageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
	const syncScript = await readFile(join(root, "scripts", "sync-skills.mjs"), "utf8");

	// when
	const sharedSkillDependency = pluginPackageJson.dependencies?.["@oh-my-opencode/shared-skills"];
	const rootPackageFiles = rootPackageJson.files ?? [];

	// then
	assert.deepEqual(sharedPackageJson.exports?.["."], {
		types: "./index.d.ts",
		import: "./index.mjs",
	});
	assert.equal(sharedPackageJson.files?.includes("skills"), true);
	assert.equal(rootPackageFiles.includes("packages/shared-skills/package.json"), true);
	assert.equal(rootPackageFiles.includes("packages/shared-skills/index.mjs"), true);
	assert.equal(rootPackageFiles.includes("packages/shared-skills/skills"), true);
	assert.equal(sharedSkillDependency, "file:../../shared-skills");
	assert.match(syncScript, /from "@oh-my-opencode\/shared-skills"/);
	assert.doesNotMatch(syncScript, /shared-skills",\s*"skills"/);
});

test("#given shared skill package source #when aggregate Codex shared skills are inspected #then generated copies have no hand-authored drift", async () => {
	// given
	const sharedSkillsRoot = sharedSkillsRootPath();
	const aggregateSkillsRoot = join(root, "skills");
	const componentSkillNames = new Set(componentSkillSources.map(([skillName]) => skillName));
	const sharedSkillNames = (await readdir(sharedSkillsRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	// when / then
	for (const skillName of sharedSkillNames) {
		if (componentSkillNames.has(skillName)) continue;
		const sharedContent = await readFile(join(sharedSkillsRoot, skillName, "SKILL.md"), "utf8");
		const aggregateContent = await readFile(join(aggregateSkillsRoot, skillName, "SKILL.md"), "utf8");
		assert.equal(
			removeCodexSkillOverlays(skillName, removeCodexCompatibilityGuidance(aggregateContent)),
			removeCodexCompatibilityGuidance(sharedContent),
			`${skillName} drifted from shared-skills`,
		);
	}
});

test("#given a shared skill name collides with a Codex component skill #when aggregate skills are inspected #then the component skill wins", async () => {
	// given
	const sharedSkill = await readFile(join(sharedSkillsRootPath(), "ulw-plan", "SKILL.md"), "utf8");
	const componentSkill = await readFile(join(root, "components", "ultrawork", "skills", "ulw-plan", "SKILL.md"), "utf8");
	const aggregateSkill = await readFile(join(root, "skills", "ulw-plan", "SKILL.md"), "utf8");

	// when / then
	assert.notEqual(removeCodexCompatibilityGuidance(aggregateSkill), removeCodexCompatibilityGuidance(sharedSkill));
	assert.equal(removeCodexCompatibilityGuidance(aggregateSkill), removeCodexCompatibilityGuidance(componentSkill));
});

test("#given shared skill source tests #when aggregate Codex skills are synced #then source tests are not packaged", async () => {
	// given
	const aggregateSkillsRoot = join(root, "skills");

	// when
	const forbiddenFiles = [];
	for (const skillName of expectedSkills) {
		for (const file of await listSkillFiles(join(aggregateSkillsRoot, skillName))) {
			const normalized = file.replaceAll("\\", "/");
			const segments = normalized.split("/");
			const scriptsIndex = segments.lastIndexOf("scripts");
			const hasPythonTestDir = scriptsIndex !== -1 && segments[scriptsIndex + 1] === "tests";
			const isSourceMetadata = normalized === ".gitignore" || normalized === ".npmignore" || normalized === "pyrightconfig.json";
			if (normalized.endsWith(".test.ts") || hasPythonTestDir || segments.includes("__pycache__") || normalized.endsWith(".pyc") || isSourceMetadata) {
				forbiddenFiles.push(`${skillName}/${normalized}`);
			}
		}
	}

	// then
	assert.deepEqual(forbiddenFiles, []);
});

test("#given component skill sources #when aggregate Codex component skills are inspected #then generated copies have no hand-authored drift", async () => {
	// given
	const aggregateSkillsRoot = join(root, "skills");

	// when / then
	for (const [skillName, sourcePath] of componentSkillSources) {
		const sourceDir = join(root, sourcePath);
		const aggregateDir = join(aggregateSkillsRoot, skillName);
		const sourceFiles = excludeGeneratedSkillMetadata(await listSkillFiles(sourceDir));
		const aggregateFiles = excludeGeneratedSkillMetadata(await listSkillFiles(aggregateDir));
		assert.deepEqual(aggregateFiles, sourceFiles, `${skillName} resource set drifted from its component skill source`);
		for (const relativePath of sourceFiles) {
			const sourceContent = await readFile(join(sourceDir, relativePath), "utf8");
			const aggregateContent = await readFile(join(aggregateDir, relativePath), "utf8");
			assert.equal(
				removeCodexSkillOverlays(skillName, removeCodexCompatibilityGuidance(aggregateContent)),
				removeCodexCompatibilityGuidance(sourceContent),
				`${skillName}/${relativePath} drifted from its component skill source`,
			);
		}
	}
});

test("#given the canonical prompts-core directive #when the aggregate ultrawork skill is inspected #then it wraps the canonical bytes in skill frontmatter", async () => {
	// given
	const canonical = await readFile(join(repoRoot, canonicalUltraworkDirectiveRelativePath), "utf8");

	// when
	const skill = await readFile(join(root, "skills", "ultrawork", "SKILL.md"), "utf8");

	// then
	assert.match(skill, /^---\r?\nname: ultrawork\r?\n/);
	assert.equal(removeCodexCompatibilityGuidance(skill).endsWith(canonical), true);
});

test("#given synced ulw-loop skill #when Codex hint metadata is inspected #then ulw-loop surfaces the ulw-loop alias", async () => {
	// given
	const skillRoot = join(root, "skills", "ulw-loop");

	// when
	const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const interfaceMetadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	// then
	assert.match(skill, /^---\r?\nname: ulw-loop\r?\n/m);
	assert.match(interfaceMetadata, /display_name: "\(OmO\) ulw-loop"/);
	assert.match(interfaceMetadata, /^\s*default_prompt:\s*".+"$/m);
});

test("#given synced ulw-loop skill #when Codex hint metadata is inspected #then ulw-loop remains discoverable as an alias", async () => {
	// given
	const skillRoot = join(root, "skills", "ulw-loop");

	// when
	const interfaceMetadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	// then
	assert.match(interfaceMetadata, /search_terms:/);
	assert.match(interfaceMetadata, /- "ulw-loop"/);
});

test("#given shipped Codex skill payloads #when legacy ultraresearch alias is inspected #then it is not packaged", async () => {
	// given
	const skillsRoot = join(root, "skills");

	// then
	await assertNoLegacyResearchAliasInTree(skillsRoot, "skills");
	for (const [skillName, sourcePath] of componentSkillSources) {
		await assertNoLegacyResearchAliasInTree(join(root, sourcePath), `components/${skillName}`);
	}
});

test("#given synced git-master skill #when inspected #then commits and git history route through it", async () => {
	// given
	const skillRoot = join(root, "skills", "git-master");

	// when
	const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const interfaceMetadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	// then
	assert.match(skill, /^---\r?\nname: git-master\r?\n/m);
	assert.match(interfaceMetadata, /display_name: "\(OmO\) git-master"/);
	assert.match(interfaceMetadata, /- "git commit"/);
	assert.match(interfaceMetadata, /- "history search"/);
});

test("#given packaged Codex ulw-plan surfaces #when inspected #then dangerous sandbox bypass guidance is not shipped", async () => {
	// given
	const dangerousBypassToken = ["dangerously", "bypass"].join("-");
	const dangerousBypassPattern = new RegExp(`${dangerousBypassToken}(?:-approvals-and-sandbox)?`);
	const packagedWorkflow = await readPackagedSkillFile("ulw-plan", "references", "full-workflow.md");
	const componentWorkflowPath = join(root, "components", "ultrawork", "skills", "ulw-plan", "references", "full-workflow.md");
	const componentWorkflow = {
		path: componentWorkflowPath,
		content: await readFile(componentWorkflowPath, "utf8"),
	};

	// when / then
	assert.doesNotMatch(packagedWorkflow.content, dangerousBypassPattern, `${packagedWorkflow.path} ships unsafe Codex bypass guidance`);
	assert.doesNotMatch(componentWorkflow.content, dangerousBypassPattern, `${componentWorkflow.path} ships unsafe Codex bypass guidance`);
});
