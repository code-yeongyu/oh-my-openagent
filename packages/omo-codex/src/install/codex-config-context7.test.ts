import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCodexConfig } from "./codex-config-toml";

describe("codex config Context7 policy", () => {
	test("#given empty Codex config #when updating config #then leaves Context7 to the plugin MCP manifest", async () => {
		// given
		const root = await mkdtemp(join(tmpdir(), "omo-codex-config-context7-"));
		const configPath = join(root, "config.toml");

		// when
		await updateCodexConfig({
			configPath,
			repoRoot: "/repo/packages/omo-codex",
			marketplaceName: "debug",
			marketplaceSource: {
				sourceType: "local",
				source: "/repo/packages/omo-codex",
			},
			pluginNames: ["omo"],
		});

		// then
		const content = await readFile(configPath, "utf8");
		expect(content).not.toContain("[mcp_servers.context7]");
		expect(content).not.toContain("@upstash/context7-mcp");
		expect(content).not.toContain("YOUR_API_KEY");
	});

	test("#given sisyphuslabs omo install #when updating config #then enables Context7 plugin mcp policy", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-context7-plugin-policy-"),
		);
		const configPath = join(root, "config.toml");

		// when
		await updateCodexConfig({
			configPath,
			repoRoot: "/repo/packages/omo-codex",
			marketplaceName: "sisyphuslabs",
			marketplaceSource: {
				sourceType: "local",
				source: "/repo/packages/omo-codex/cache/sisyphuslabs",
			},
			pluginNames: ["omo"],
		});

		// then
		const content = await readFile(configPath, "utf8");
		expect(content).toContain(
			'[plugins."omo@sisyphuslabs".mcp_servers.context7]',
		);
		expect(content).toMatch(
			/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\][\s\S]*?enabled = true/,
		);
		expect(content).not.toContain("[mcp_servers.context7]");
		expect(content).not.toContain("@upstash/context7-mcp");
		expect(content).not.toContain("YOUR_API_KEY");
	});

	test("#given existing Context7 MCP server #when updating config #then leaves user server settings untouched", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-context7-existing-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				"[mcp_servers.context7] # stale npx package from old docs",
				'command = "node"',
				'args = ["/opt/context7/server.js"]',
				"startup_timeout_sec = 40",
				"",
			].join("\n"),
		);

		// when
		await updateCodexConfig({
			configPath,
			repoRoot: "/repo/packages/omo-codex",
			marketplaceName: "debug",
			marketplaceSource: {
				sourceType: "local",
				source: "/repo/packages/omo-codex",
			},
			pluginNames: ["omo"],
		});

		// then
		const content = await readFile(configPath, "utf8");
		expect(content).toContain("[mcp_servers.context7]");
		expect(content).toContain('command = "node"');
		expect(content).toContain('args = ["/opt/context7/server.js"]');
		expect(content).toContain("startup_timeout_sec = 40");
		expect(content).not.toContain("YOUR_API_KEY");
	});

	test("#given real Context7 API key and placeholder comment #when updating config #then preserves user server settings", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-context7-real-key-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				"[mcp_servers.context7]",
				'command = "npx"',
				'args = ["-y", "@upstash/context7-mcp", "--api-key", "ctx7sk_live_example"] # replace YOUR_API_KEY in docs only',
				"startup_timeout_sec = 20",
				"",
			].join("\n"),
		);

		// when
		await updateCodexConfig({
			configPath,
			repoRoot: "/repo/packages/omo-codex",
			marketplaceName: "sisyphuslabs",
			marketplaceSource: {
				sourceType: "local",
				source: "/repo/packages/omo-codex/cache/sisyphuslabs",
			},
			pluginNames: ["omo"],
		});

		// then
		const content = await readFile(configPath, "utf8");
		expect(content).toContain("[mcp_servers.context7]");
		expect(content).toContain("ctx7sk_live_example");
		expect(content).toContain("replace YOUR_API_KEY in docs only");
		expect(content).toContain(
			'[plugins."omo@sisyphuslabs".mcp_servers.context7]',
		);
	});

	test("#given stale Context7 placeholder MCP server #when updating config #then removes it for the plugin MCP", async () => {
		// given
		const root = await mkdtemp(
			join(tmpdir(), "omo-codex-config-context7-placeholder-"),
		);
		const configPath = join(root, "config.toml");
		await writeFile(
			configPath,
			[
				"[mcp_servers.context7]",
				'command = "npx"',
				'args = ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]',
				"startup_timeout_sec = 20",
				"",
			].join("\n"),
		);

		// when
		await updateCodexConfig({
			configPath,
			repoRoot: "/repo/packages/omo-codex",
			marketplaceName: "sisyphuslabs",
			marketplaceSource: {
				sourceType: "local",
				source: "/repo/packages/omo-codex/cache/sisyphuslabs",
			},
			pluginNames: ["omo"],
		});

		// then
		const content = await readFile(configPath, "utf8");
		expect(content).toContain(
			'[plugins."omo@sisyphuslabs".mcp_servers.context7]',
		);
		expect(content).not.toContain("[mcp_servers.context7]");
		expect(content).not.toContain("@upstash/context7-mcp");
		expect(content).not.toContain("YOUR_API_KEY");
	});
});
