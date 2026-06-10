import { describe, expect, it } from "vitest";

import { currentRequestContext } from "../src/daemon-client.js";

describe("currentRequestContext", () => {
	it("#given project, user, and install-decision config env #when building request context #then forwards only those keys", () => {
		const context = currentRequestContext({
			LSP_TOOLS_MCP_PROJECT_CONFIG: ".opencode/lsp.json:.omo/lsp.json",
			LSP_TOOLS_MCP_USER_CONFIG: "~/.omo/lsp.json",
			LSP_TOOLS_MCP_INSTALL_DECISIONS: "~/.omo/lsp-install-decisions.json",
			PATH: "/usr/bin",
			HOME: "/home/me",
		});

		expect(context.cwd).toBe(process.cwd());
		expect(context.env).toEqual({
			LSP_TOOLS_MCP_PROJECT_CONFIG: ".opencode/lsp.json:.omo/lsp.json",
			LSP_TOOLS_MCP_USER_CONFIG: "~/.omo/lsp.json",
			LSP_TOOLS_MCP_INSTALL_DECISIONS: "~/.omo/lsp-install-decisions.json",
		});
	});

	it("#given no lsp config env #when building request context #then forwards an empty env bag", () => {
		const context = currentRequestContext({ PATH: "/usr/bin" });

		expect(context.env).toEqual({});
	});
});
