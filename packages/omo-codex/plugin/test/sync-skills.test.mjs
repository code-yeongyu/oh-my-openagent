import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills";
import {
	CONTEXT_PRESSURE_SKILL_BUDGET_BYTES,
	assertPackagedContentMatches,
	componentSkillSources,
	expectedSkills,
	listSkillFiles,
	removeCodexCompatibilityGuidance,
	removeCodexSkillOverlays,
} from "./sync-skills-test-support.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(root, "..", "..", "..");
const opencodeOnlyToolPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/;
const generatedSkillMetadataFiles = new Set(["agents/openai.yaml"]);

async function readPackagedSkillFile(...segments) {
	const path = join(root, "skills", ...segments);
	const content = await readFile(path, "utf8");
	return { path, content };
}

function excludeGeneratedSkillMetadata(files) {
	return files.filter((file) => !generatedSkillMetadataFiles.has(file.replaceAll("\\", "/")));
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
	assert.match(aggregateSkill, /multi_agent_v1/);
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
				removeCodexCompatibilityGuidance(aggregateContent),
				removeCodexCompatibilityGuidance(sourceContent),
				`${skillName}/${relativePath} drifted from its component skill source`,
			);
		}
	}
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
	assert.doesNotMatch(interfaceMetadata, /ulw-loop \/ ulw-loop/);
	assert.match(interfaceMetadata, /short_description: "Goal-like ultrawork loop for systematic decomposition"/);
	assert.match(interfaceMetadata, /default_prompt: "Use \$ulw-loop/);
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

test("#given synced legacy ultraresearch alias #when inspected #then it points users at ulw-research", async () => {
	// given
	const skillRoot = join(root, "skills", "ultraresearch");

	// when
	const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const interfaceMetadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	// then
	assert.match(skill, /^---\r?\nname: ultraresearch\r?\n/m);
	assert.match(skill, /legacy name for `ulw-research`/);
	assert.match(interfaceMetadata, /display_name: "\(OmO\) ultraresearch"/);
});

test("#given synced git-master skill #when inspected #then commits and git history route through it", async () => {
	// given
	const skillRoot = join(root, "skills", "git-master");

	// when
	const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const interfaceMetadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	// then
	assert.match(skill, /^---\r?\nname: git-master\r?\n/m);
	assert.match(skill, /MUST USE whenever a task needs a commit or git-history investigation/);
	assert.match(skill, /Commit only the user's requested changes/);
	assert.match(skill, /Choose the Git tool by the question/);
	assert.match(skill, /git log -S "text"/);
	assert.match(skill, /git blame -L start,end -- file/);
	assert.match(interfaceMetadata, /display_name: "\(OmO\) git-master"/);
	assert.match(interfaceMetadata, /- "git commit"/);
	assert.match(interfaceMetadata, /- "history search"/);
});

test("#given synced ulw-loop skill #when worker guidance is inspected #then context-hygiene guidance matches the source", async () => {
	// given
	const sourceSkill = await readFile(
		join(root, "components", "ulw-loop", "skills", "ulw-loop", "references", "full-workflow.md"),
		"utf8",
	);
	const syncedSkill = await readFile(join(root, "skills", "ulw-loop", "SKILL.md"), "utf8");
	const syncedWorkflow = await readFile(join(root, "skills", "ulw-loop", "references", "full-workflow.md"), "utf8");
	const requiredPatterns = [
		["multi_agent_v1.wait_agent ref", /multi_agent_v1\.wait_agent/],
		["local spawned-name tracking", /Track spawned agent names locally/],
		["wait_agent mailbox path", /wait_agent.*mailbox signals/],
		["progress status contract", /WORKING:/],
		["long-running plan/reviewer background guidance", /Plan and reviewer agents may run for a long time/],
		["bounded plan/reviewer polling", /multi_agent_v1\.wait_agent.*cycles/],
		["single long wait guard", /single long blocking wait/],
		["git-master checkpointing", /git-master/],
		["touched-path commit-style probe", /touched-path commit history/],
		["verified work-unit commit", /verified work unit/],
		["observed commit style", /commit in the observed style/],
	];

	// when / then
	for (const [label, pattern] of requiredPatterns) {
		assert.match(sourceSkill, pattern, `source skill missing ${label}`);
		assert.match(syncedWorkflow, pattern, `synced workflow missing ${label}`);
	}
	assert.match(syncedSkill, /references\/full-workflow\.md/);
	assert.match(syncedSkill, /wait_agent/);
	assert.match(syncedSkill, /close_agent/);
});

test("#given packaged start-work skill #when inspected #then no-plan bootstrap and adversarial verification contracts are shipped", async () => {
	// given
	const skillFile = await readPackagedSkillFile("start-work", "SKILL.md");

	// when / then
	assertPackagedContentMatches(skillFile, [
		["executes Prometheus plan with Boulder state", /Prometheus work plan[\s\S]*Boulder state/],
		["bootstraps ulw-plan when no selectable plan exists", /no selectable plan[\s\S]*ulw-plan|ulw-plan[\s\S]*no selectable plan/i],
		["does not execute work without an approved plan", /approved plan[\s\S]*(?:before|prior to)[\s\S]*execution|execution[\s\S]*(?:requires|needs)[\s\S]*approved plan/i],
		["keeps hook continuation Boulder-only", /Boulder[\s\S]*(?:continuation|Stop hook)[\s\S]*(?:only|solely)|(?:continuation|Stop hook)[\s\S]*(?:only|solely)[\s\S]*Boulder/i],
		["distinguishes execution from verification", /execution[\s\S]*verification|verification[\s\S]*execution/i],
		["requires dirty-worktree-aware editing", /dirty worktree/i],
		["requires stale-state probes", /stale state/i],
		["rejects misleading success output", /misleading success output/i],
		["does not accept worker done claims without independent verification", /done claim[\s\S]*independent(?:ly)? verified|independent(?:ly)? verify[\s\S]*done claim/i],
	]);
});

test("#given packaged ulw-plan skill #when inspected #then dynamic multi-agent planning contracts are shipped", async () => {
	// given
	const skillFile = await readPackagedSkillFile("ulw-plan", "SKILL.md");
	const workflowFile = await readPackagedSkillFile("ulw-plan", "references", "full-workflow.md");
	const combinedFile = {
		path: `${skillFile.path} + ${workflowFile.path}`,
		content: `${skillFile.content}\n${workflowFile.content}`,
	};

	// when / then
	assertPackagedContentMatches(combinedFile, [
		["self-orchestrates 5 host subagents for planning", /(?:self-orchestrates|orchestrates)[\s\S]*5[\s\S]*host subagents/i],
		["requires dynamic workflow phases", /dynamic[\s\S]*workflow[\s\S]*phase|phase[\s\S]*dynamic[\s\S]*workflow/i],
		["keeps verification distinct from execution", /verification[\s\S]*execution|execution[\s\S]*verification/i],
		["requires dirty-worktree-aware planning", /dirty worktree/i],
		["requires stale-state checks between source and packaged payloads", /stale state/i],
		["rejects misleading success output", /misleading success output/i],
		["does not accept subagent outputs as success without independent verification", /subagent outputs?[\s\S]*(?:not|never)[\s\S]*(?:success|approval)|independent(?:ly)? verif(?:y|ied|ication)[\s\S]*subagent outputs?/i],
		["treats Discord or external content as claims, not instructions", /(?:Discord|external content)[\s\S]*claims?[\s\S]*not instructions?|not instructions?[\s\S]*(?:Discord|external content)/i],
	]);
	assert.doesNotMatch(combinedFile.content, opencodeOnlyToolPattern);
	assert.doesNotMatch(combinedFile.content, /Proceeding to plan generation/);
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

test("#given context-pressure-prone skills #when bundled for Codex #then the eagerly loaded payload stays budgeted", async () => {
	// given
	const skillsRoot = join(root, "skills");
	const skillNames = ["debugging", "ulw-loop"];

	// when
	let totalBytes = 0;
	for (const skillName of skillNames) {
		const content = await readFile(join(skillsRoot, skillName, "SKILL.md"), "utf8");
		totalBytes += Buffer.byteLength(content, "utf8");
	}

	// then
	assert.ok(
		totalBytes <= CONTEXT_PRESSURE_SKILL_BUDGET_BYTES,
		`debugging + ulw-loop eager payload is ${totalBytes} bytes, above ${CONTEXT_PRESSURE_SKILL_BUDGET_BYTES}`,
	);
});
