import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(dirname(pluginRoot)));
const componentReference = join(pluginRoot, "components", "ultrawork", "skills", "ulw-plan", "references", "intent-unclear.md");
const sharedReference = join(repositoryRoot, "packages", "shared-skills", "skills", "ulw-plan", "references", "intent-unclear.md");

test("#given an unclear auth-improvement request #when ulw-plan derives its full-scope components #then it preserves evidenced intent without inventing reduction or MFA expansion", async () => {
	const [component, shared] = await Promise.all([
		readFile(componentReference, "utf8"),
		readFile(sharedReference, "utf8"),
	]);

	for (const reference of [component, shared]) {
		assert.match(reference, /components that refine the user's requested or evidence-backed intent/i);
		assert.match(reference, /neither collapse into an invented reduced subset nor expand into adjacent features/i);
		assert.match(reference, /MFA is an adjacent capability.*Scope OUT unless the user asks.*evidence establishes/i);
		assert.doesNotMatch(reference, /MFA - all four planned in full/i);
	}
});
