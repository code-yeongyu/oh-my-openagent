import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	canonicalUltraworkDirectiveRelativePath,
	resolveCanonicalUltraworkDirectivePath,
} from "../scripts/canonical-ultrawork-directive.mjs";

test("#given a repo checkout #when resolving the ultrawork directive #then the checkout copy wins over a plugin-internal copy", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-canonical-prompt-"));
	const pluginRoot = join(root, "plugin");
	const repoRoot = join(root, "checkout");
	const checkoutPrompt = join(repoRoot, canonicalUltraworkDirectiveRelativePath);
	const pluginPrompt = join(pluginRoot, canonicalUltraworkDirectiveRelativePath);
	await mkdir(join(checkoutPrompt, ".."), { recursive: true });
	await mkdir(join(pluginPrompt, ".."), { recursive: true });
	await writeFile(checkoutPrompt, "checkout");
	await writeFile(pluginPrompt, "staged");

	try {
		// when
		const resolved = resolveCanonicalUltraworkDirectivePath(pluginRoot, repoRoot);

		// then
		assert.equal(resolved, checkoutPrompt);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("#given the flattened plugin cache #when the repo-relative directive is absent #then the plugin-internal copy is resolved", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-canonical-prompt-"));
	const pluginRoot = join(root, "plugins", "cache", "sisyphuslabs", "omo", "0.1.0");
	const repoRoot = join(pluginRoot, "..", "..", "..");
	const pluginPrompt = join(pluginRoot, canonicalUltraworkDirectiveRelativePath);
	await mkdir(join(pluginPrompt, ".."), { recursive: true });
	await writeFile(pluginPrompt, "staged");

	try {
		// when
		const resolved = resolveCanonicalUltraworkDirectivePath(pluginRoot, repoRoot);

		// then
		assert.equal(resolved, pluginPrompt);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
