import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveDefaultRepoRoot } from "./install-local.mjs";

test("#given published lazycodex bin runs outside the package #when resolving default repo root #then uses installer location", () => {
	// given
	const scriptsDir = dirname(fileURLToPath(import.meta.url));

	// when
	const repoRoot = resolveDefaultRepoRoot();

	// then
	assert.equal(repoRoot, join(scriptsDir, "..", "..", ".."));
});
