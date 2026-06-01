import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(pluginRoot, "..", "..", "..");

test("#given Codex Light install docs #when inspected #then lazycodex is npm-first and Bun-free", async () => {
	// given
	const files = [
		join(repoRoot, "README.md"),
		join(repoRoot, "docs", "guide", "installation.md"),
		join(repoRoot, "packages", "omo-codex", "README.md"),
		join(repoRoot, "packages", "omo-codex", "MARKETPLACE.md"),
		join(pluginRoot, "components", "ultrawork", "README.md"),
		join(pluginRoot, "components", "ulw-loop", "README.md"),
	];

	// when
	const docs = await Promise.all(files.map(async (path) => [path, await readFile(path, "utf8")]));

	// then
	for (const [path, text] of docs) {
		assert.match(text, /\bnpx lazycodex-ai install\b/, `${path} should document the Node/npm install command`);
		assert.doesNotMatch(text, /\bbunx lazycodex-ai\b/, `${path} should not require Bun for lazycodex`);
	}
});

test("#given cleanup troubleshooting docs #when inspected #then project-local cleanup and command delegation are documented", async () => {
	// given
	const files = [
		join(repoRoot, "README.md"),
		join(repoRoot, "docs", "guide", "installation.md"),
		join(repoRoot, "packages", "omo-codex", "README.md"),
	];

	// when
	const docs = await Promise.all(files.map(async (path) => [path, await readFile(path, "utf8")]));

	// then
	for (const [path, text] of docs) {
		assert.match(text, /\bnpx lazycodex-ai cleanup\b/, `${path} should document the LazyCodex cleanup command`);
		assert.match(text, /project-local .*\.codex\/config\.toml/i, `${path} should mention project-local config repair`);
		assert.match(text, /\.codex.*\.omx|\.omx.*\.codex/s, `${path} should distinguish project-local .codex and .omx artifacts`);
	}
});
