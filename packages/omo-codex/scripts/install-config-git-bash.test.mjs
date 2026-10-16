import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { updateCodexConfig } from "./install-dist/install-local.mjs";

test("#given windows platform with Git Bash enabled #when updating config #then enables git_bash plugin mcp policy", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-config-git-bash-win32-"));
	const configPath = join(root, "config.toml");
	await writeFile(
		configPath,
		[
			'[plugins."omo@sisyphuslabs"]',
			"enabled = true",
			"",
			'[plugins."omo@sisyphuslabs".mcp_servers.lsp]',
			"enabled = true",
			"",
			'[hooks.state."omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0"]',
			'trusted_hash = "sha256:keep"',
			"",
		].join("\n"),
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "sisyphuslabs",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex/cache/sisyphuslabs" },
		pluginNames: ["omo"],
		platform: "win32",
		gitBashEnabled: true,
		trustedHookStates: [{ key: "omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0", trustedHash: "sha256:keep" }],
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.match(content, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.lsp\]/);
	assert.match(content, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\]/);
	assert.match(content, /\[hooks\.state\."omo@sisyphuslabs:hooks\/hooks\.json:post_tool_use:0:0"\]/);
	assert.match(content, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\][\s\S]*?enabled = true/);
});

test("#given windows platform without Git Bash enabled #when updating config #then disables git_bash plugin mcp policy", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-config-git-bash-win32-disabled-"));
	const configPath = join(root, "config.toml");

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "sisyphuslabs",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex/cache/sisyphuslabs" },
		pluginNames: ["omo"],
		platform: "win32",
		gitBashEnabled: false,
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.match(content, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\]/);
	assert.match(content, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\][\s\S]*?enabled = false/);
});

test("#given non-windows platforms #when updating config #then disables git_bash plugin mcp policy", async () => {
	for (const platform of ["linux", "darwin"]) {
		// given
		const root = await mkdtemp(join(tmpdir(), `omo-codex-config-git-bash-${platform}-`));
		const configPath = join(root, "config.toml");

		// when
		await updateCodexConfig({
			configPath,
			repoRoot: "/repo/packages/omo-codex",
			marketplaceName: "sisyphuslabs",
			marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex/cache/sisyphuslabs" },
			pluginNames: ["omo"],
			platform,
		});

		// then
		const content = await readFile(configPath, "utf8");
		assert.match(content, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\]/);
		assert.match(content, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\][\s\S]*?enabled = false/);
	}
});
