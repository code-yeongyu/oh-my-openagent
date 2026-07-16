import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sharedSkillsRoot = join(pluginRoot, "..", "..", "shared-skills");

test("#given lcx skills #when frontmatter is inspected #then each exposes the loader-parsed skill name", async () => {
	for (const skillName of ["lcx-report-bug", "lcx-contribute-bug-fix", "lcx-doctor"]) {
		// when
		const skill = await readFile(join(sharedSkillsRoot, "skills", skillName, "SKILL.md"), "utf8");

		// then
		assert.match(skill, new RegExp(`^name: ${skillName}$`, "m"), `${skillName}: frontmatter must expose ${skillName}`);
	}
});
