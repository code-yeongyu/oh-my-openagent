import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { installCachedPlugin } from "./install-dist/install-local.mjs";
import { makeTempDir, writeJson } from "./install-test-fixtures.mjs";

async function installContext7RuntimeFixture(context7) {
	const repoRoot = await makeTempDir();
	const codexHome = await makeTempDir();
	const sourceRoot = join(repoRoot, "packages", "omo-codex", "plugin");

	await writeJson(join(sourceRoot, "package.json"), { name: "@example/omo", version: "0.1.0" });
	await writeJson(join(sourceRoot, ".mcp.json"), { mcpServers: { context7 } });

	const result = await installCachedPlugin({
		codexHome,
		marketplaceName: "sisyphuslabs",
		name: "omo",
		runCommand: async () => {},
		sourcePath: sourceRoot,
		version: "0.1.0",
	});

	const rawManifest = await readFile(join(result.path, ".mcp.json"), "utf8");
	return { cachedMcp: JSON.parse(rawManifest), rawManifest };
}

test("#given Context7 placeholder auth in generated installer path #when installing cached plugin #then placeholder auth is stripped", async () => {
	const { cachedMcp, rawManifest } = await installContext7RuntimeFixture({
		command: "bunx",
		args: ["--bun", "-y", "@upstash/context7-mcp", "--api-key", "your api key"],
		cwd: ".",
		env: { CONTEXT7_API_KEY: "<YOUR_API_KEY>", SAFE_FLAG: "1" },
	});

	assert.deepEqual(cachedMcp.mcpServers.context7.args, ["--bun", "-y", "@upstash/context7-mcp"]);
	assert.deepEqual(cachedMcp.mcpServers.context7.env, { SAFE_FLAG: "1" });
	assert.equal(Object.hasOwn(cachedMcp.mcpServers.context7, "cwd"), false);
	assert.doesNotMatch(rawManifest, /your api key/i);
	assert.doesNotMatch(rawManifest, /YOUR_API_KEY/);
	assert.doesNotMatch(rawManifest, /--api-key/);
});

test("#given real Context7 auth in generated installer path #when installing cached plugin #then user auth is preserved", async () => {
	const { cachedMcp } = await installContext7RuntimeFixture({
		command: "bunx",
		args: ["--bun", "-y", "@upstash/context7-mcp", "--api-key", "ctx7sk_real_user_key"],
		cwd: ".",
		env: { CONTEXT7_API_KEY: "ctx7sk_real_env_key" },
	});

	assert.deepEqual(cachedMcp.mcpServers.context7.args, [
		"--bun",
		"-y",
		"@upstash/context7-mcp",
		"--api-key",
		"ctx7sk_real_user_key",
	]);
	assert.deepEqual(cachedMcp.mcpServers.context7.env, { CONTEXT7_API_KEY: "ctx7sk_real_env_key" });
	assert.equal(Object.hasOwn(cachedMcp.mcpServers.context7, "cwd"), false);
});

test("#given env-only Context7 placeholder auth in generated installer path #when installing cached plugin #then placeholder env is stripped", async () => {
	const { cachedMcp, rawManifest } = await installContext7RuntimeFixture({
		url: "https://mcp.context7.com/mcp",
		env: { CONTEXT7_API_KEY: "YOUR_API_KEY", SAFE_FLAG: "1" },
	});

	assert.deepEqual(cachedMcp.mcpServers.context7.env, { SAFE_FLAG: "1" });
	assert.doesNotMatch(rawManifest, /YOUR_API_KEY/);
});

test("#given dangling Context7 api-key flag in generated installer path #when installing cached plugin #then blank auth flag is stripped", async () => {
	const { cachedMcp, rawManifest } = await installContext7RuntimeFixture({
		command: "bunx",
		args: ["--bun", "-y", "@upstash/context7-mcp", "--api-key"],
	});

	assert.deepEqual(cachedMcp.mcpServers.context7.args, ["--bun", "-y", "@upstash/context7-mcp"]);
	assert.equal(Object.hasOwn(cachedMcp.mcpServers.context7, "env"), false);
	assert.doesNotMatch(rawManifest, /--api-key/);
});
