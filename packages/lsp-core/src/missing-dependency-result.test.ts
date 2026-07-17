import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { LspServerLookupError } from "./lsp/errors.js";
import { missingDependencyResult } from "./missing-dependency-result.js";
import { parseLspRequestContext, runWithRequestContext } from "./request-context.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function tempRoot(): string {
	const root = mkdtempSync(join(homedir(), "lsp-missing-dep-"));
	tempDirectories.push(root);
	return root;
}

describe("missingDependencyResult", () => {
	it("#given not configured lookup #when converted #then includes structured availability and typed config paths", () => {
		const root = tempRoot();
		const projectConfigPath = join(root, ".codex", "lsp-client.json");
		const userConfigPath = join(homedir(), ".codex", "lsp-client.json");
		const installDecisionsPath = join(homedir(), ".codex", "lsp-install-decisions.json");
		const context = parseLspRequestContext({
			cwd: root,
			projectConfigPaths: [projectConfigPath],
			userConfigPath,
			installDecisionsPath,
			capabilities: { installDecisionTool: false },
		});

		const result = runWithRequestContext(context, () =>
			missingDependencyResult(
				new LspServerLookupError("No LSP server configured for extension: .foo", {
					status: "not_configured",
					extension: ".foo",
					availableServers: ["typescript"],
				}),
				{ filePath: "src/file.foo" },
			),
		);

		expect(result?.details).toEqual({
			filePath: "src/file.foo",
			error: "No LSP server configured for extension: .foo",
			errorKind: "missing_dependency",
			availability: {
				kind: "not_configured",
				extension: ".foo",
				availableServers: ["typescript"],
				projectConfigPaths: [projectConfigPath],
				userConfigPath,
				installDecisionTool: false,
			},
		});
	});

	it("#given not installed lookup #when converted #then includes install decision availability", () => {
		const root = tempRoot();
		const installDecisionsPath = join(homedir(), ".codex", "lsp-install-decisions.json");
		const context = parseLspRequestContext({
			cwd: root,
			projectConfigPaths: [join(root, ".codex", "lsp-client.json")],
			userConfigPath: join(homedir(), ".codex", "lsp-client.json"),
			installDecisionsPath,
			capabilities: { installDecisionTool: true },
		});

		const result = runWithRequestContext(context, () =>
			missingDependencyResult(
				new LspServerLookupError("LSP server 'typescript' for .ts is NOT INSTALLED.", {
					status: "not_installed",
					server: {
						id: "typescript",
						command: ["typescript-language-server", "--stdio"],
						extensions: [".ts"],
					},
					installHint: "npm install -g typescript-language-server typescript",
				}),
				{ filePath: "src/file.ts" },
			),
		);

		expect(result?.details).toEqual({
			filePath: "src/file.ts",
			error: "LSP server 'typescript' for .ts is NOT INSTALLED.",
			errorKind: "missing_dependency",
			availability: {
				kind: "not_installed",
				serverId: "typescript",
				command: ["typescript-language-server", "--stdio"],
				extensions: [".ts"],
				installHint: "npm install -g typescript-language-server typescript",
				installDecisionTool: true,
				installDecisionsPath,
			},
		});
	});
});
