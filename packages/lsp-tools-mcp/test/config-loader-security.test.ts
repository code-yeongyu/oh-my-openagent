import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getMergedServers } from "../src/lsp/config-loader.js";
import { createStandaloneMcpRequestContext, runWithRequestContext } from "../src/request-context.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("config loader security", () => {
	it("#given project config path list #when first file is missing #then loads later OMO config path", () => {
		// given
		const previousProject = process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"];
		const previousUser = process.env["LSP_TOOLS_MCP_USER_CONFIG"];
		const root = mkdtempSync(join(tmpdir(), "lsp-tools-project-path-list-"));
		tempDirectories.push(root);
			const omoConfig = join(root, ".omo", "lsp.json");
		const userConfig = join(root, "user.json");
		mkdirSync(join(root, ".omo"), { recursive: true });
		writeFileSync(
			omoConfig,
			JSON.stringify({
				lsp: {
					typescript: { extensions: [".mts"], priority: 11 },
				},
			}),
		);
		writeFileSync(userConfig, JSON.stringify({ lsp: {} }));
			process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"] = [join(".opencode", "lsp.json"), join(".omo", "lsp.json")].join(
				delimiter,
			);
		process.env["LSP_TOOLS_MCP_USER_CONFIG"] = userConfig;

		try {
			// when
				const servers = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () => getMergedServers());

			// then
			expect(servers).toContainEqual(
				expect.objectContaining({
					id: "typescript",
					command: ["typescript-language-server", "--stdio"],
					extensions: [".mts"],
					priority: 11,
					source: "project",
				}),
			);
		} finally {
			restoreEnv("LSP_TOOLS_MCP_PROJECT_CONFIG", previousProject);
			restoreEnv("LSP_TOOLS_MCP_USER_CONFIG", previousUser);
		}
	});

	it("#given project config defines a custom executable server #when merging servers #then ignores that server", () => {
		// given
		const previousProject = process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"];
		const previousUser = process.env["LSP_TOOLS_MCP_USER_CONFIG"];
		const root = mkdtempSync(join(tmpdir(), "lsp-tools-project-exec-"));
		tempDirectories.push(root);
		const projectConfig = join(root, "project.json");
		const userConfig = join(root, "user.json");
		writeFileSync(
			projectConfig,
			JSON.stringify({
				lsp: {
					malicious: {
						command: ["sh", "-c", "touch owned"],
						extensions: [".owned"],
						env: { PATH: "/tmp/malicious" },
					},
				},
			}),
		);
		writeFileSync(userConfig, JSON.stringify({ lsp: {} }));
			process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"] = "project.json";
		process.env["LSP_TOOLS_MCP_USER_CONFIG"] = userConfig;

		try {
			// when
				const servers = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () => getMergedServers());

			// then
			expect(servers.some((server) => server.id === "malicious")).toBe(false);
		} finally {
			restoreEnv("LSP_TOOLS_MCP_PROJECT_CONFIG", previousProject);
			restoreEnv("LSP_TOOLS_MCP_USER_CONFIG", previousUser);
		}
	});

	it("#given project config tunes a builtin server #when merging servers #then keeps builtin command and applies safe fields", () => {
		// given
		const previousProject = process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"];
		const previousUser = process.env["LSP_TOOLS_MCP_USER_CONFIG"];
		const root = mkdtempSync(join(tmpdir(), "lsp-tools-project-tune-"));
		tempDirectories.push(root);
		const projectConfig = join(root, "project.json");
		const userConfig = join(root, "user.json");
		writeFileSync(
			projectConfig,
			JSON.stringify({
				lsp: {
					typescript: {
						command: ["sh", "-c", "touch owned"],
						extensions: [".cts"],
						priority: 42,
						env: { NODE_OPTIONS: "--require /tmp/owned.js" },
						initialization: { preferences: { quoteStyle: "single" } },
					},
				},
			}),
		);
		writeFileSync(userConfig, JSON.stringify({ lsp: {} }));
			process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"] = "project.json";
		process.env["LSP_TOOLS_MCP_USER_CONFIG"] = userConfig;

		try {
			// when
				const servers = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () => getMergedServers());

			// then
			expect(servers).toContainEqual(
				expect.objectContaining({
					id: "typescript",
					command: ["typescript-language-server", "--stdio"],
					extensions: [".cts"],
					priority: 42,
					source: "project",
					initialization: { preferences: { quoteStyle: "single" } },
				}),
			);
			expect(servers.find((server) => server.id === "typescript")).not.toHaveProperty("env");
		} finally {
			restoreEnv("LSP_TOOLS_MCP_PROJECT_CONFIG", previousProject);
			restoreEnv("LSP_TOOLS_MCP_USER_CONFIG", previousUser);
		}
	});
});

function restoreEnv(
	name: "LSP_TOOLS_MCP_PROJECT_CONFIG" | "LSP_TOOLS_MCP_USER_CONFIG",
	previous: string | undefined,
): void {
	if (previous === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = previous;
}
