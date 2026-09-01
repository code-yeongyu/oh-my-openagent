import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	codexHarnessToolCompatibility,
	insertCodexCompatibilityGuidance,
} from "../scripts/sync-skills.mjs";

const frontmatter = "---\nname: fixture-sentinel\n---\n\n";
const opencodeExample = "# SENTINEL_SECTION\ntask(SENTINEL_INPUT)\n";
const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = join(pluginRoot, "..", "..");
const opencodeToolPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/;

test("#given sentinel OpenCode tool content #when compatibility guidance is inserted #then the production artifact is placed after frontmatter and before the tool token", () => {
	const input = `${frontmatter}${opencodeExample}`;

	const actual = insertCodexCompatibilityGuidance(input);

	assert.equal(actual, `${frontmatter}${codexHarnessToolCompatibility}${opencodeExample}`);
	assert.ok(actual.indexOf(codexHarnessToolCompatibility) < actual.indexOf(opencodeExample));
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
		/applyCodexSkillOverlays\(\s*skillName,\s*insertCodexCompatibilityGuidance\(content\),?\s*\)/,
	);
	assert.match(script, /await adaptSkillForCodex\(skillName\)/);
});
