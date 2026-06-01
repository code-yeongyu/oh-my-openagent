import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

test("#given lazycodex version flag #when running the Node installer entrypoint #then prints the package version", () => {
	// given
	const scriptPath = fileURLToPath(new URL("./install-local.mjs", import.meta.url));
	const manifestPath = fileURLToPath(new URL("../../../package.json", import.meta.url));
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

	// when
	const output = execFileSync(process.execPath, [scriptPath, "--version"], {
		encoding: "utf8",
	}).trim();

	// then
	assert.equal(output, `lazycodex-ai ${manifest.version}`);
});
