import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("#given synced lcx-report-bug skill #when inspected #then it files LazyCodex bug issues with generated labels", async () => {
	// given
	const skillRoot = join(root, "skills", "lcx-report-bug");

	// when
	const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const interfaceMetadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	// then
	assert.match(skill, /^---\r?\nname: lcx-report-bug\r?\n/m);
	assert.match(skill, /Never create a PR or push a branch against `code-yeongyu\/lazycodex`/);
	assert.match(skill, /gh pr create --repo openai\/codex/);
	assert.doesNotMatch(skill, /gh pr create --repo "\$TARGET_REPO"/);
	assert.doesNotMatch(skill, /gh pr create --repo code-yeongyu\/lazycodex/);
	assert.match(interfaceMetadata, /display_name: "lcx-report-bug \(omo\)"/);
	assert.match(interfaceMetadata, /- "lazycodex bug"/);
	assert.match(interfaceMetadata, /- "openai codex bug"/);
});

test("#given synced lcx-contribute-bug-fix skill #when inspected #then it delivers LazyCodex fixes as issues and upstream fixes as fork PRs", async () => {
	// given
	const skillRoot = join(root, "skills", "lcx-contribute-bug-fix");

	// when
	const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const interfaceMetadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	// then
	assert.match(skill, /^---\r?\nname: lcx-contribute-bug-fix\r?\n/m);
	assert.match(skill, /NEVER open a PR or push a branch against this repo/);
	assert.match(skill, /gh issue create --repo code-yeongyu\/lazycodex/);
	assert.match(skill, /gh pr create --repo openai\/codex/);
	assert.doesNotMatch(skill, /gh pr create --repo "\$TARGET_REPO"/);
	assert.doesNotMatch(skill, /gh pr create --repo code-yeongyu\/lazycodex/);
	assert.match(interfaceMetadata, /display_name: "lcx-contribute-bug-fix \(omo\)"/);
	assert.match(interfaceMetadata, /- "contribute a bug fix"/);
	assert.match(interfaceMetadata, /- "fix bug pr"/);
});

test("#given synced lcx-doctor skill #when inspected #then it diagnoses installs against latest /tmp sources without mutating them", async () => {
	// given
	const skillRoot = join(root, "skills", "lcx-doctor");

	// when
	const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const interfaceMetadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	// then
	assert.match(skill, /^---\r?\nname: lcx-doctor\r?\n/m);
	assert.match(interfaceMetadata, /display_name: "lcx-doctor \(omo\)"/);
	assert.match(interfaceMetadata, /- "lazycodex doctor"/);
	assert.match(interfaceMetadata, /- "lazycodex health check"/);
});
