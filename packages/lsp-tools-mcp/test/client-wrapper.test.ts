import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { LspClient } from "../src/lsp/client.js";
import { findWorkspaceRoot, withLspClient } from "../src/lsp/client-wrapper.js";
import { LspManager } from "../src/lsp/manager.js";
import type { ResolvedServer } from "../src/lsp/types.js";

import { FakeLspClient } from "./helpers/fake-lsp-client.js";

function restoreEnv(name: "LSP_TOOLS_MCP_USER_CONFIG", previous: string | undefined): void {
	if (previous === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = previous;
}

describe("withLspClient", () => {
	it("#given nested workspace #when callback runs #then callback receives the resolved workspace root", async () => {
		// given
		const previousUserConfig = process.env["LSP_TOOLS_MCP_USER_CONFIG"];
		const root = mkdtempSync(join(tmpdir(), "lsp-client-wrapper-root-"));
		const parentWorkspace = join(root, "parent");
		const nestedWorkspace = join(parentWorkspace, "nested");
		const filePath = join(nestedWorkspace, "src", "fixture.cbroot");
		const userConfig = join(root, "user-lsp.json");
		const rootsSeen: string[] = [];
		const clients: FakeLspClient[] = [];

		mkdirSync(join(nestedWorkspace, "src"), { recursive: true });
		writeFileSync(join(parentWorkspace, "package.json"), "{}");
		writeFileSync(join(nestedWorkspace, "package.json"), "{}");
		writeFileSync(filePath, "const value = 1;\n");
		writeFileSync(userConfig, JSON.stringify({
			lsp: {
				callbackRoot: {
					command: [process.execPath],
					extensions: [".cbroot"],
				},
			},
		}));
		process.env["LSP_TOOLS_MCP_USER_CONFIG"] = userConfig;

		const manager = new LspManager({
			clientFactory: (workspaceRoot: string, server: ResolvedServer): LspClient => {
				const client = new FakeLspClient(workspaceRoot, server);
				clients.push(client);
				return client;
			},
		});

		try {
			// when
			const result = await withLspClient(
				filePath,
				async (_client, workspaceRoot) => {
					rootsSeen.push(workspaceRoot);
					return workspaceRoot;
				},
				"rename",
				{ manager },
			);

			// then
			expect(findWorkspaceRoot(filePath)).toBe(nestedWorkspace);
			expect(result).toBe(nestedWorkspace);
			expect(rootsSeen).toEqual([nestedWorkspace]);
			expect(clients[0]?.stopCallCount).toBe(0);
		} finally {
			restoreEnv("LSP_TOOLS_MCP_USER_CONFIG", previousUserConfig);
			await manager.stopAll();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
