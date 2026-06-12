import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getConfigPaths, getMergedServers } from "../src/lsp/config-loader.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("config loader", () => {
	it("uses Codex config locations instead of pi config locations", () => {
		const paths = getConfigPaths();
		const expectedSuffix = join(".codex", "lsp-client.json");
		const piMarker = `${sep}.pi${sep}`;

		expect(paths.project.endsWith(expectedSuffix)).toBe(true);
		expect(paths.user.endsWith(expectedSuffix)).toBe(true);
		expect(paths.project).not.toContain(piMarker);
		expect(paths.user).not.toContain(piMarker);
	});

	it("supports project and user config path overrides via environment variables", () => {
		const previousProject = process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"];
		const previousUser = process.env["LSP_TOOLS_MCP_USER_CONFIG"];

		process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"] = "config/lsp-opencode.json";
		process.env["LSP_TOOLS_MCP_USER_CONFIG"] = ".opencode/lsp.json";

		try {
			const paths = getConfigPaths();

			expect(paths.project).toBe(join(process.cwd(), "config", "lsp-opencode.json"));
			expect(paths.user).toBe(join(process.env["HOME"] ?? "", ".opencode", "lsp.json"));
		} finally {
			if (previousProject === undefined) {
				delete process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"];
			} else {
				process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"] = previousProject;
			}

			if (previousUser === undefined) {
				delete process.env["LSP_TOOLS_MCP_USER_CONFIG"];
			} else {
				process.env["LSP_TOOLS_MCP_USER_CONFIG"] = previousUser;
			}
		}
	});

	it("keeps absolute override paths unchanged", () => {
		const previousProject = process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"];
		const previousUser = process.env["LSP_TOOLS_MCP_USER_CONFIG"];
		const absoluteProject = join(process.cwd(), "overrides", "project.json");
		const absoluteUser = join(process.cwd(), "overrides", "user.json");

		process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"] = absoluteProject;
		process.env["LSP_TOOLS_MCP_USER_CONFIG"] = absoluteUser;

		try {
			const paths = getConfigPaths();

			expect(paths.project).toBe(absoluteProject);
			expect(paths.user).toBe(absoluteUser);
		} finally {
			if (previousProject === undefined) {
				delete process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"];
			} else {
				process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"] = previousProject;
			}

			if (previousUser === undefined) {
				delete process.env["LSP_TOOLS_MCP_USER_CONFIG"];
			} else {
				process.env["LSP_TOOLS_MCP_USER_CONFIG"] = previousUser;
			}
		}
	});

	it("#given one invalid user LSP config entry #when merging servers #then keeps valid sibling entries", () => {
		// given
		const previousProject = process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"];
		const previousUser = process.env["LSP_TOOLS_MCP_USER_CONFIG"];
		const root = mkdtempSync(join(tmpdir(), "lsp-tools-config-"));
		tempDirectories.push(root);
		const projectConfig = join(root, "project.json");
		const userConfig = join(root, "user.json");
		mkdirSync(root, { recursive: true });
		writeFileSync(projectConfig, JSON.stringify({ lsp: {} }));
		writeFileSync(
			userConfig,
			JSON.stringify({
				lsp: {
					valid: { command: ["valid-lsp", "--stdio"], extensions: [".valid"], priority: 7 },
					invalid: "not an object",
				},
			}),
		);
		process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"] = projectConfig;
		process.env["LSP_TOOLS_MCP_USER_CONFIG"] = userConfig;

		try {
			// when
			const servers = getMergedServers();

			// then
			expect(servers).toContainEqual(
				expect.objectContaining({
					id: "valid",
					command: ["valid-lsp", "--stdio"],
					extensions: [".valid"],
					priority: 7,
					source: "user",
				}),
			);
			expect(servers.some((server) => server.id === "invalid")).toBe(false);
		} finally {
			if (previousProject === undefined) {
				delete process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"];
			} else {
				process.env["LSP_TOOLS_MCP_PROJECT_CONFIG"] = previousProject;
			}

			if (previousUser === undefined) {
				delete process.env["LSP_TOOLS_MCP_USER_CONFIG"];
			} else {
				process.env["LSP_TOOLS_MCP_USER_CONFIG"] = previousUser;
			}
		}
	});
});
