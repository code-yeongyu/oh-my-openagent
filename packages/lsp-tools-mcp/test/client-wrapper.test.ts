import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LspClient } from "../src/lsp/client.js";
import { findWorkspaceRoot, formatServerLookupError, withLspClient } from "../src/lsp/client-wrapper.js";
import { LspManager } from "../src/lsp/manager.js";
import { recordInstallDecision } from "../src/lsp/server-install-state.js";
import type { ResolvedServer, ServerLookupResult } from "../src/lsp/types.js";

import { FakeLspClient } from "./helpers/fake-lsp-client.js";

function restoreEnv(name: "LSP_TOOLS_MCP_USER_CONFIG", previous: string | undefined): void {
	if (previous === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = previous;
}

const DECISIONS_ENV = "LSP_TOOLS_MCP_INSTALL_DECISIONS";
const notInstalled: Exclude<ServerLookupResult, { status: "found" }> = {
	status: "not_installed",
	server: { id: "rust", command: ["rust-analyzer"], extensions: [".rs"] },
	installHint: "rustup component add rust-analyzer",
};

describe("formatServerLookupError install decisions", () => {
	const tempDirectories: string[] = [];
	let previousDecisionsEnv: string | undefined;

	function useDecisionsFile(): void {
		const dir = mkdtempSync(join(tmpdir(), "lsp-format-decisions-"));
		tempDirectories.push(dir);
		process.env[DECISIONS_ENV] = join(dir, "lsp-install-decisions.json");
	}

	beforeEach(() => {
		previousDecisionsEnv = process.env[DECISIONS_ENV];
		useDecisionsFile();
	});

	afterEach(() => {
		if (previousDecisionsEnv === undefined) {
			delete process.env[DECISIONS_ENV];
		} else {
			process.env[DECISIONS_ENV] = previousDecisionsEnv;
		}
		for (const directory of tempDirectories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("#given no recorded decision #when formatting not_installed #then asks the user and explains decline recording", () => {
		// when
		const message = formatServerLookupError(notInstalled);

		// then
		expect(message).toContain("NOT INSTALLED");
		expect(message).toContain("rust-analyzer");
		expect(message).toContain("rustup component add rust-analyzer");
		expect(message).toContain("ASK THE USER");
		expect(message).toContain("lsp_install_decision");
		expect(message).toContain('"declined"');
		expect(message.toLowerCase()).toContain("proceed without lsp");
	});

	it("#given a declined decision #when formatting not_installed #then returns a minimal one-line ignorable note", () => {
		// given
		recordInstallDecision("rust", "declined");

		// when
		const message = formatServerLookupError(notInstalled);

		// then
		expect(message.trim().split("\n")).toHaveLength(1);
		expect(message).toContain("NOT INSTALLED");
		expect(message.toLowerCase()).toContain("declined");
		expect(message.toLowerCase()).toContain("proceed without lsp");
		expect(message).not.toContain("ASK THE USER");
	});

	it("#given an allowed decision #when formatting not_installed #then keeps install steps but skips the ask", () => {
		// given
		recordInstallDecision("rust", "allowed");

		// when
		const message = formatServerLookupError(notInstalled);

		// then
		expect(message).toContain("NOT INSTALLED");
		expect(message).toContain("rustup component add rust-analyzer");
		expect(message).not.toContain("ASK THE USER");
		expect(message.toLowerCase()).toContain("pre-authorized");
	});

	it("#given any decision state #when formatting not_installed #then keeps the hook quiet marker", () => {
		const noDecision = formatServerLookupError(notInstalled);
		recordInstallDecision("rust", "declined");
		const declined = formatServerLookupError(notInstalled);
		recordInstallDecision("rust", "allowed");
		const allowed = formatServerLookupError(notInstalled);

		for (const message of [noDecision, declined, allowed]) {
			expect(message).toContain("NOT INSTALLED");
		}
	});
});

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
		writeFileSync(
			userConfig,
			JSON.stringify({
				lsp: {
					callbackRoot: {
						command: [process.execPath],
						extensions: [".cbroot"],
					},
				},
			}),
		);
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
