import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sharedSkillsRoot = join(pluginRoot, "..", "..", "shared-skills");

async function readSkill(name) {
	return readFile(join(sharedSkillsRoot, "skills", name, "SKILL.md"), "utf8");
}

test("#given synced lcx-report-bug skill #when inspected #then it files LazyCodex bug issues with generated labels", async () => {
	// given
	const skillRoot = join(sharedSkillsRoot, "skills", "lcx-report-bug");

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
	const skillRoot = join(sharedSkillsRoot, "skills", "lcx-contribute-bug-fix");

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

test("#given synced lcx-doctor skill #when inspected #then it diagnoses installs against latest temp-root sources without mutating them", async () => {
	// given
	const skillRoot = join(sharedSkillsRoot, "skills", "lcx-doctor");

	// when
	const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const interfaceMetadata = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");

	// then
	assert.match(skill, /^---\r?\nname: lcx-doctor\r?\n/m);
	assert.match(interfaceMetadata, /display_name: "lcx-doctor \(omo\)"/);
	assert.match(interfaceMetadata, /- "lazycodex doctor"/);
	assert.match(interfaceMetadata, /- "lazycodex health check"/);
});

test("#given lcx source-sync skills #when inspected #then source caches are validated before reuse", async () => {
	// given
	const skillNames = ["lcx-doctor", "lcx-report-bug", "lcx-contribute-bug-fix"];

	for (const skillName of skillNames) {
		// when
		const skill = await readSkill(skillName);

		// then
		assert.match(skill, /LAZYCODEX_SOURCE_ROOT="\$\{LAZYCODEX_SOURCE_ROOT:-\$\{TMPDIR:-\/tmp\}\/lazycodex-sources\}"/);
		assert.match(skill, /git -C "\$DEST" rev-parse --is-inside-work-tree/);
		assert.match(skill, /git -C "\$DEST" config --get remote\.origin\.url/);
		assert.match(skill, /DEST\.corrupt\.\$\(date \+%Y%m%d%H%M%S\)/);
		assert.doesNotMatch(skill, /if \[ ! -d "\$DEST\/\.git" \]; then/);
		assert.doesNotMatch(skill, /sync_latest_source code-yeongyu\/lazycodex \/tmp\/lazycodex-source/);
		assert.doesNotMatch(skill, /sync_latest_source openai\/codex \/tmp\/openai-codex-source/);
	}
});

test("#given lcx-doctor skill #when inspected #then aggregate hook validation follows the current manifest", async () => {
	// given
	const skill = await readSkill("lcx-doctor");

	// then
	assert.match(skill, /\.codex-plugin\/plugin\.json/);
	assert.match(skill, /manifest declares a `hooks` array/);
	assert.match(skill, /validate every direct hook path declared by the manifest/);
	assert.match(skill, /`hooks\/hooks\.json` only when the manifest declares it/);
	assert.doesNotMatch(skill, /Plugin payload present and non-empty: `hooks\/hooks\.json`/);
});
