import { describe, expect, it } from "vitest";
import { join } from "node:path";

import { currentRequestContext } from "../src/daemon-client.js";

describe("currentRequestContext", () => {
	it("#given unrelated env #when building request context #then constructs exact typed Codex defaults without forwarded env", () => {
		const context = currentRequestContext({
			LSP_TOOLS_MCP_PROJECT_CONFIG: ".opencode/lsp.json:.omo/lsp.json",
			LSP_TOOLS_MCP_USER_CONFIG: "~/.omo/lsp.json",
			LSP_TOOLS_MCP_INSTALL_DECISIONS: "~/.omo/lsp-install-decisions.json",
			PATH: "/usr/bin",
			HOME: "/home/me",
		});

		expect(context.cwd).toBe(process.cwd());
		expect(context.projectConfigPaths).toEqual([join(process.cwd(), ".codex", "lsp-client.json")]);
		expect(context.userConfigPath).toBe(join("/home/me", ".codex", "lsp-client.json"));
		expect(context.installDecisionsPath).toBe(join("/home/me", ".codex", "lsp-install-decisions.json"));
		expect(context.capabilities).toEqual({ installDecisionTool: true });
	});

	it("#given no lsp config env #when building request context #then still returns an exact typed context", () => {
		const context = currentRequestContext({ PATH: "/usr/bin" });

		expect(context.projectConfigPaths).toEqual([join(process.cwd(), ".codex", "lsp-client.json")]);
		expect(context.capabilities.installDecisionTool).toBe(true);
	});
});
