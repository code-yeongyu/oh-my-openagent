import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function readUlwResearchCopies() {
	const sharedPath = join(sharedSkillsRootPath(), "ulw-research", "SKILL.md");
	const packagedPath = join(root, "skills", "ulw-research", "SKILL.md");
	return [
		{ label: "shared", path: sharedPath, content: await readFile(sharedPath, "utf8") },
		{ label: "packaged", path: packagedPath, content: await readFile(packagedPath, "utf8") },
	];
}

test("#given ulw-research skill copies #when frontmatter is inspected #then the loader-parsed name is ulw-research", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.match(copy.content, /^name: ulw-research$/m, `${copy.label}: frontmatter must expose ulw-research`);
	}
});

test("#given ulw-research skill copies #when scanned for non-English content #then they contain no Hangul", async () => {
	for (const copy of await readUlwResearchCopies()) {
		assert.doesNotMatch(copy.content, /[ᄀ-ᇿ㄰-㆏가-힣]/, `${copy.label} copy contains Hangul characters`);
	}
});
