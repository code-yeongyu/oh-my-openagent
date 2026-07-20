import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const EXPECTED_COMPONENT_BINS = new Map([
	["comment-checker", ["omo-comment-checker"]],
	["lsp", ["omo-lsp"]],
	["rules", ["omo-rules"]],
	["start-work-continuation", ["omo-start-work-continuation"]],
	["telemetry", ["omo-telemetry"]],
	["ultrawork", ["omo-ultrawork"]],
	["ulw-loop", ["omo-ulw-loop", "ulw", "ulw-loop"]],
]);

const EXPECTED_USAGE_PREFIXES = new Map([
	["comment-checker", "Usage: omo-comment-checker "],
	["lsp", "Usage: omo-lsp "],
	["rules", "Usage: omo-rules "],
	["start-work-continuation", "Usage: omo-start-work-continuation "],
	["telemetry", "Usage: omo-telemetry "],
	["ultrawork", "Usage: omo-ultrawork "],
]);

async function readJson(relativePath) {
	return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

test("#given aggregate component package metadata #when bin names are inspected #then component CLIs expose documented commands", async () => {
	// given
	const components = [...EXPECTED_COMPONENT_BINS.entries()];

	// when
	const mismatches = [];
	for (const [component, expectedNames] of components) {
		const packageJson = await readJson(join("components", component, "package.json"));
		const bin = packageJson.bin ?? {};
		const binNames = Object.keys(bin).sort();
		const missing = expectedNames.filter((expectedName) => bin[expectedName] !== "./dist/cli.js");
		if (missing.length > 0 || binNames.some((name) => name.startsWith("codex-"))) {
			mismatches.push({ component, missing, bin });
		}
	}

	// then
	assert.deepEqual(mismatches, []);
});

test("#given component CLI sources #when usage text is inspected #then user-facing command names use OMO names", async () => {
	// given
	const components = [...EXPECTED_USAGE_PREFIXES.entries()];

	// when
	const mismatches = [];
	for (const [component, expectedUsage] of components) {
		const source = await readFile(join(root, "components", component, "src", "cli.ts"), "utf8");
		if (!source.includes(expectedUsage) || /Usage: codex-/.test(source)) {
			mismatches.push({ component, expectedUsage });
		}
	}

	// then
	assert.deepEqual(mismatches, []);
});
