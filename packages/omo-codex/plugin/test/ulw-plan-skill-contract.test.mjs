import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("#given ulw-plan skill copies #when component source and packaged copy are compared #then they are byte-identical and expose the loader-parsed name", async () => {
	// given
	const componentPath = join(root, "components", "ultrawork", "skills", "ulw-plan", "SKILL.md");
	const packagedPath = join(root, "skills", "ulw-plan", "SKILL.md");

	// when
	const component = await readFile(componentPath, "utf8");
	const packaged = await readFile(packagedPath, "utf8");

	// then
	assert.equal(packaged, component);
	assert.match(component, /^name: ulw-plan$/m);
});
