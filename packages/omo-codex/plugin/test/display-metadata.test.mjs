import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import { readJson, root } from "./aggregate-plugin-fixture.mjs";

const hookSlugPattern = /^\.\/hooks\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/;
const displayNamePrefix = "(OmO) ";

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

async function readSkillName(skillPath) {
	const content = await readFile(skillPath, "utf8");
	const frontmatter = content.match(/^---\n(?<body>[\s\S]*?)\n---\n/);
	assert(frontmatter?.groups?.body, `${skillPath} must have YAML frontmatter`);
	const name = frontmatter.groups.body.match(/^name:\s*"?([^"\n]+)"?\s*$/m)?.[1]?.trim();
	assert(name, `${skillPath} must have a frontmatter name`);
	return name;
}

async function readOpenAiDisplayName(skillDir) {
	const metadataPath = join(skillDir, "agents", "openai.yaml");
	assert(await exists(metadataPath), `${basename(skillDir)} must include agents/openai.yaml`);
	const content = await readFile(metadataPath, "utf8");
	const displayName = content.match(/^\s*display_name:\s*"?([^"\n]+)"?\s*$/m)?.[1]?.trim();
	assert(displayName, `${metadataPath} must define interface.display_name`);
	return displayName;
}

test("#given Codex plugin hooks #when plugin metadata is inspected #then hook keys contain human-readable hook slugs", async () => {
	// given
	const manifest = await readJson(".codex-plugin/plugin.json");

	// when
	const hookPaths = manifest.hooks;

	// then
	assert(Array.isArray(hookPaths), "plugin manifest hooks must list per-hook metadata files");
	assert(hookPaths.length > 0, "plugin manifest must expose at least one hook file");
	for (const hookPath of hookPaths) {
		assert.equal(typeof hookPath, "string");
		assert.match(hookPath, hookSlugPattern);
		assert.notEqual(hookPath, "./hooks/hooks.json");
		const hooksJson = await readJson(hookPath.replace(/^\.\//, ""));
		const commandHookCount = Object.values(hooksJson.hooks)
			.flat()
			.flatMap((group) => group.hooks)
			.filter((hook) => hook.type === "command").length;
		assert.equal(commandHookCount, 1, `${hookPath} should describe exactly one displayed hook`);
	}
});

test("#given Codex plugin skills #when skill metadata is inspected #then every skill has an OmO display name", async () => {
	// given
	const skillsDir = join(root, "skills");
	const skillEntries = await readdir(skillsDir, { withFileTypes: true });
	const skillDirs = skillEntries.filter((entry) => entry.isDirectory()).map((entry) => join(skillsDir, entry.name));

	// when
	const invalidDisplayNames = [];
	for (const skillDir of skillDirs) {
		const skillPath = join(skillDir, "SKILL.md");
		if (!(await exists(skillPath))) continue;
		const skillName = await readSkillName(skillPath);
		const displayName = await readOpenAiDisplayName(dirname(skillPath));
		const expected = `${displayNamePrefix}${skillName}`;
		if (displayName !== expected) {
			invalidDisplayNames.push(`${basename(skillDir)}: expected ${expected}, got ${displayName}`);
		}
	}

	// then
	assert.deepEqual(invalidDisplayNames, []);
});
