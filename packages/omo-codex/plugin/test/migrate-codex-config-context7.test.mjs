import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateCodexConfig } from "../scripts/migrate-codex-config.mjs";

test("#given stale Context7 placeholder MCP config #when migrating #then removes it and keeps plugin policy", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "lazycodex-context7-placeholder-cleanup-"),
	);
	const codexHome = join(root, "codex-home");
	const configPath = join(codexHome, "config.toml");
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			"model_context_window = 400000",
			'model_reasoning_effort = "high"',
			'plan_mode_reasoning_effort = "xhigh"',
			"",
			"[mcp_servers.context7] # stale npx package from old docs",
			'command = "npx"',
			'args = ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]',
			"startup_timeout_sec = 20",
			"",
			'[plugins."omo@sisyphuslabs".mcp_servers.context7]',
			"enabled = true",
			"",
		].join("\n"),
	);

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: root,
	});

	const content = await readFile(configPath, "utf8");
	assert.deepEqual(result.changed, [configPath]);
	assert.doesNotMatch(content, /\[mcp_servers\.context7\]/);
	assert.doesNotMatch(content, /@upstash\/context7-mcp/);
	assert.doesNotMatch(content, /YOUR_API_KEY/);
	assert.match(
		content,
		/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\][\s\S]*?enabled = true/,
	);
});

test("#given real Context7 API key and placeholder comment #when migrating #then preserves user server settings", async () => {
	const root = await mkdtemp(join(tmpdir(), "lazycodex-context7-real-key-"));
	const codexHome = join(root, "codex-home");
	const configPath = join(codexHome, "config.toml");
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		configPath,
		[
			'model = "gpt-5.5"',
			"model_context_window = 400000",
			'model_reasoning_effort = "high"',
			'plan_mode_reasoning_effort = "xhigh"',
			"",
			"[mcp_servers.context7]",
			'command = "npx"',
			'args = ["-y", "@upstash/context7-mcp", "--api-key", "ctx7sk_live_example"] # replace YOUR_API_KEY in docs only',
			"startup_timeout_sec = 20",
			"",
			'[plugins."omo@sisyphuslabs".mcp_servers.context7]',
			"enabled = true",
			"",
		].join("\n"),
	);

	const result = await migrateCodexConfig({
		env: {
			CODEX_HOME: codexHome,
			LAZYCODEX_MODEL_CATALOG_STATE_PATH: join(root, "model-state.json"),
		},
		cwd: root,
	});

	const content = await readFile(configPath, "utf8");
	assert.deepEqual(result.changed, [configPath]);
	assert.match(content, /\[mcp_servers\.context7\]/);
	assert.match(content, /ctx7sk_live_example/);
	assert.match(content, /replace YOUR_API_KEY in docs only/);
	assert.match(
		content,
		/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\][\s\S]*?enabled = true/,
	);
});
