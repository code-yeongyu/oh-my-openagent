import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { updateCodexConfig } from "./install/config.mjs";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(packageRoot, "..", "..", "..");

test("#given OMX-owned Codex config #when lazycodex updates config #then preserves OMX blocks", async () => {
	const root = await mkdtemp(join(tmpdir(), "omo-codex-omx-compat-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			"[features]",
			"plugins = false",
			"",
			"[tui]",
			'hud = "omx"',
			"",
			"[shell_environment_policy]",
			'inherit = "core"',
			"",
		].join("\n"),
	);

	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "sisyphuslabs",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex/cache/sisyphuslabs" },
		pluginNames: ["omo"],
	});

	const config = await readFile(configPath, "utf8");
	assert.match(config, /\[features\][\s\S]*plugins = true/);
	assert.match(config, /\[tui\][\s\S]*hud = "omx"/);
	assert.match(config, /\[shell_environment_policy\][\s\S]*inherit = "core"/);
	assert.match(config, /\[plugins\."omo@sisyphuslabs"\]/);
});

test("#given Codex Light docs #when inspected #then OMX coexistence is documented", async () => {
	const docs = await Promise.all(
		[
			join(repoRoot, "packages", "omo-codex", "README.md"),
			join(repoRoot, "packages", "omo-codex", "MARKETPLACE.md"),
			join(repoRoot, "docs", "guide", "installation.md"),
		].map(async (path) => [path, await readFile(path, "utf8")]),
	);

	for (const [path, text] of docs) {
		assert.match(text, /oh-my-codex \(OMX\)/, `${path} should name OMX compatibility`);
		assert.match(text, /preserves unrelated `?\[features\]`?, `?\[tui\]`?, and `?\[shell_environment_policy\]`? blocks/, `${path} should document config preservation`);
		assert.match(text, /does not define hook precedence/, `${path} should document hook precedence limits`);
		assert.match(text, /rerun `npx lazycodex-ai install` after `omx setup`/, `${path} should document repair order`);
	}
});
