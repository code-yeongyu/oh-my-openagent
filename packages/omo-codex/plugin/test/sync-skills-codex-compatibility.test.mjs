import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalUltraworkDirectiveRelativePath } from "../scripts/canonical-ultrawork-directive.mjs";

import {
	applyCodexSkillOverlays,
	codexHarnessToolCompatibility,
	insertCodexCompatibilityGuidance,
	reviewWorkAnchor,
	ulwExecuteOriginalCompletion,
	ulwExecuteOriginalHardRule,
} from "../scripts/sync-skills.mjs";

const frontmatter = "---\nname: fixture-sentinel\n---\n\n";
const opencodeExample = "# SENTINEL_SECTION\ntask(SENTINEL_INPUT)\n";
const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = join(pluginRoot, "..", "..");
const opencodeToolPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/;
const sharedSkillsRoot = join(repositoryRoot, "shared-skills", "skills");

test("#given sentinel OpenCode tool content #when compatibility guidance is inserted #then the production artifact is placed after frontmatter and before the tool token", () => {
	const input = `${frontmatter}${opencodeExample}`;

	const actual = insertCodexCompatibilityGuidance(input);

	assert.equal(actual, `${frontmatter}${codexHarnessToolCompatibility}${opencodeExample}`);
	assert.ok(actual.indexOf(codexHarnessToolCompatibility) < actual.indexOf(opencodeExample));
});

test("#given shared skill source anchors #when Codex overlays are applied #then exact anchors transform and match the generated artifacts", async () => {
	const ulwExecuteSource = await readFile(join(sharedSkillsRoot, "ulw-execute", "SKILL.md"), "utf8");
	const reviewWorkSource = await readFile(join(sharedSkillsRoot, "review-work", "SKILL.md"), "utf8");

	assert.ok(ulwExecuteSource.includes(ulwExecuteOriginalCompletion), "ulw-execute completion anchor drifted from shared source");
	assert.ok(ulwExecuteSource.includes(ulwExecuteOriginalHardRule), "ulw-execute hard-rule anchor drifted from shared source");
	assert.ok(reviewWorkSource.includes(reviewWorkAnchor), "review-work anchor drifted from shared source");

	for (const [skillName, source] of [["ulw-execute", ulwExecuteSource], ["review-work", reviewWorkSource]]) {
		const compatible = insertCodexCompatibilityGuidance(source);
		const overlaid = applyCodexSkillOverlays(skillName, compatible);
		assert.notEqual(overlaid, compatible, `${skillName} overlay must change the shared source`);
		assert.equal(applyCodexSkillOverlays(skillName, overlaid), overlaid, `${skillName} overlay must be idempotent`);
		assert.equal(await readFile(join(pluginRoot, "skills", skillName, "SKILL.md"), "utf8"), overlaid);
	}
});

test("#given already transformed sentinel content #when compatibility guidance is inserted again #then the transform is idempotent", () => {
	const once = insertCodexCompatibilityGuidance(`${frontmatter}${opencodeExample}`);

	const twice = insertCodexCompatibilityGuidance(once);

	assert.equal(twice, once);
});

test("#given a stale generated compatibility block #when guidance is inserted #then the production artifact replaces it", () => {
	const staleSentinel = "STALE_GENERATED_SENTINEL";
	const staleGuidance = codexHarnessToolCompatibility.replace("multi_agent_v1.spawn_agent", staleSentinel);
	assert.notEqual(staleGuidance, codexHarnessToolCompatibility);

	const actual = insertCodexCompatibilityGuidance(`${frontmatter}${staleGuidance}${opencodeExample}`);

	assert.equal(actual, `${frontmatter}${codexHarnessToolCompatibility}${opencodeExample}`);
	assert.equal(actual.includes(staleSentinel), false);
});

test("#given a custom compatibility block before an OpenCode tool token #when guidance is inserted #then the custom block is preserved", () => {
	const generatedHeading = codexHarnessToolCompatibility.slice(0, codexHarnessToolCompatibility.indexOf("\n") + 1);
	const customBlock = `${generatedHeading}\nCUSTOM_BLOCK_SENTINEL\n\n`;
	const input = `${frontmatter}${customBlock}${opencodeExample}`;

	const actual = insertCodexCompatibilityGuidance(input);

	assert.equal(actual, input);
});

test("#given an exported template wrapper containing an OpenCode tool token #when guidance is inserted #then wrapper bytes are preserved", () => {
	const templateWrapper = "export const TEMPLATE_SENTINEL = `task(INPUT_SENTINEL)`;\n";

	const actual = insertCodexCompatibilityGuidance(templateWrapper);

	assert.equal(actual, `${codexHarnessToolCompatibility}${templateWrapper}`);
});

test("#given real shared skills that need Codex translation #when aggregate skills are synced #then each generated skill injects the production compatibility artifact once before any remaining OpenCode tool token", async () => {
	const sharedSkillsRoot = join(repositoryRoot, "shared-skills", "skills");
	const entries = await readdir(sharedSkillsRoot, { withFileTypes: true });
	const syncScript = await readFile(join(pluginRoot, "scripts", "sync-skills.mjs"), "utf8");
	const componentSkillNames = new Set(
		[...syncScript.matchAll(/\[\s*"([^"]+)"\s*,\s*"components\//g)].map((match) => match[1]),
	);
	let checked = 0;

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (componentSkillNames.has(entry.name)) continue;
		const source = await readFile(join(sharedSkillsRoot, entry.name, "SKILL.md"), "utf8");
		const sourceToolToken = source.match(opencodeToolPattern)?.[0];
		if (!sourceToolToken) continue;
		const generated = await readFile(join(pluginRoot, "skills", entry.name, "SKILL.md"), "utf8");

		assert.equal(generated.split(codexHarnessToolCompatibility).length - 1, 1, entry.name);
		const compatibilityIndex = generated.indexOf(codexHarnessToolCompatibility);
		assert.ok(compatibilityIndex >= 0, entry.name);
		const firstGeneratedToolIndex = generated.search(opencodeToolPattern);
		assert.ok(firstGeneratedToolIndex >= compatibilityIndex, entry.name);
		assert.ok(firstGeneratedToolIndex < compatibilityIndex + codexHarnessToolCompatibility.length, entry.name);
		checked += 1;
	}

	assert.ok(checked > 0, "at least one shared skill must exercise compatibility injection");
});

test("#given the aggregate sync implementation #when its skill adaptation pipeline is inspected #then it still applies compatibility guidance before overlays", async () => {
	const script = await readFile(join(pluginRoot, "scripts", "sync-skills.mjs"), "utf8");

	assert.match(
		script,
		/applyCodexSkillOverlays\(\s*skillName,\s*insertCodexCompatibilityGuidance\(content,\s*needsSpawnPayloadGuidance\),?\s*\)/,
	);
	assert.match(script, /await adaptSkillForCodex\(skillName\)/);
});

test("#given the flattened plugin cache the Codex installer produces #when sync-skills runs inside it #then it resolves shared skills through the linked package and writes the skill tree", async () => {
	// given: installMarketplaceLocally copies plugin/ (minus node_modules) to
	// <CODEX_HOME>/plugins/cache/<marketplace>/omo/<version>, materializes the canonical directive
	// under that root, links @oh-my-opencode/shared-skills through the rewritten file: dependency,
	// and only then runs `npm run sync:skills` there. packages/shared-skills is NOT a sibling of
	// that directory, so a checkout-relative import cannot resolve in this layout.
	const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cache-layout-"));
	const cachedPluginRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "0.0.0-cache-layout");
	await cp(pluginRoot, cachedPluginRoot, {
		recursive: true,
		filter: (source) => {
			const parts = relative(pluginRoot, source).split(sep);
			return parts[0] !== "skills" && !parts.includes("node_modules") && !parts.includes(".git");
		},
	});
	const directiveTarget = join(cachedPluginRoot, canonicalUltraworkDirectiveRelativePath);
	await mkdir(dirname(directiveTarget), { recursive: true });
	await cp(join(repositoryRoot, "..", canonicalUltraworkDirectiveRelativePath), directiveTarget);
	const linkedSharedSkills = join(cachedPluginRoot, "node_modules", "@oh-my-opencode", "shared-skills");
	await mkdir(dirname(linkedSharedSkills), { recursive: true });
	await symlink(join(repositoryRoot, "shared-skills"), linkedSharedSkills, "dir");

	try {
		// when: the installer runs `npm run sync:skills` here, whose script is `node scripts/sync-skills.mjs`
		const result = spawnSync(process.execPath, [join(cachedPluginRoot, "scripts", "sync-skills.mjs")], {
			cwd: cachedPluginRoot,
			encoding: "utf8",
		});

		// then
		assert.equal(result.status, 0, `sync-skills failed in the cache layout:\n${result.stderr}`);
		const syncedSkills = (await readdir(join(cachedPluginRoot, "skills"), { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
		assert.ok(syncedSkills.includes("ultrawork"), "component skill ultrawork must be synced");
		assert.ok(syncedSkills.includes("git-master"), "shared skill git-master must be synced from the linked package");
	} finally {
		await rm(codexHome, { recursive: true, force: true });
	}
});
