import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import {
	createStandaloneMcpRequestContext,
	LspRequestContextUnavailableError,
	LspRequestContextParseError,
	parseLspRequestContext,
	runWithRequestContext,
	lspRequestContext,
} from "./request-context.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function tempRoot(prefix: string): string {
	const root = mkdtempSync(join(homedir(), prefix));
	tempDirectories.push(root);
	return root;
}

function tempSystemRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	tempDirectories.push(root);
	return root;
}

describe("LspRequestContext", () => {
	it("#given exact typed context #when parsed #then canonicalizes cwd and preserves typed paths", () => {
		const root = tempRoot("lsp-context-root-");
		const projectPath = join(root, ".codex", "lsp-client.json");
		const userPath = join(homedir(), ".codex", "lsp-client.json");
		const decisionsPath = join(homedir(), ".codex", "lsp-install-decisions.json");
		mkdirSync(join(root, ".codex"), { recursive: true });

		const context = parseLspRequestContext({
			cwd: join(root, "."),
			projectConfigPaths: [projectPath],
			userConfigPath: userPath,
			installDecisionsPath: decisionsPath,
			capabilities: { installDecisionTool: false },
		});

		expect(context).toEqual({
			cwd: root,
			projectConfigPaths: [projectPath],
			userConfigPath: userPath,
			installDecisionsPath: decisionsPath,
			capabilities: { installDecisionTool: false },
		});
		expect(runWithRequestContext(context, () => lspRequestContext())).toEqual(context);
	});

	it("#given no active context #when requested #then throws an actionable typed error", () => {
		expect(() => lspRequestContext()).toThrow(LspRequestContextUnavailableError);
	});

	it("#given unknown field #when parsed #then rejects before lookup", () => {
		const root = tempRoot("lsp-context-unknown-");
		const projectPath = join(root, ".codex", "lsp-client.json");

		expect(() =>
			parseLspRequestContext({
				cwd: root,
				projectConfigPaths: [projectPath],
				userConfigPath: join(homedir(), ".codex", "lsp-client.json"),
				installDecisionsPath: join(homedir(), ".codex", "lsp-install-decisions.json"),
				capabilities: { installDecisionTool: true },
				env: {},
			}),
		).toThrow(LspRequestContextParseError);
	});

	it("#given project path outside cwd #when parsed #then rejects before config loading", () => {
		const root = tempRoot("lsp-context-confined-");
		const outside = tempRoot("lsp-context-outside-");

		expect(() =>
			parseLspRequestContext({
				cwd: root,
				projectConfigPaths: [join(outside, "lsp-client.json")],
				userConfigPath: join(homedir(), ".codex", "lsp-client.json"),
				installDecisionsPath: join(homedir(), ".codex", "lsp-install-decisions.json"),
				capabilities: { installDecisionTool: true },
			}),
		).toThrow(LspRequestContextParseError);
	});

	it("#given equivalent macOS var spelling #when parsed #then canonicalizes to one identity", () => {
		const systemRoot = tempSystemRoot("lsp-context-private-var-");
		const canonicalRoot = realpathSync(systemRoot);
		const aliasRoot = canonicalRoot.startsWith("/private/var/") ? canonicalRoot.replace("/private/var/", "/var/") : systemRoot;
		mkdirSync(join(canonicalRoot, ".codex"), { recursive: true });

		const context = parseLspRequestContext({
			cwd: aliasRoot,
			projectConfigPaths: [join(aliasRoot, ".codex", "lsp-client.json")],
			userConfigPath: join(homedir(), ".codex", "lsp-client.json"),
			installDecisionsPath: join(homedir(), ".codex", "lsp-install-decisions.json"),
			capabilities: { installDecisionTool: true },
		});

		expect(context.cwd).toBe(canonicalRoot);
		expect(context.projectConfigPaths).toEqual([join(canonicalRoot, ".codex", "lsp-client.json")]);
	});

	it("#given missing standard project config inside cwd #when parsed #then accepts and preserves the intended suffix", () => {
		const root = tempRoot("lsp-context-missing-config-");
		mkdirSync(join(root, ".codex"), { recursive: true });

		const context = parseLspRequestContext({
			cwd: root,
			projectConfigPaths: [join(root, ".codex", "missing-lsp-client.json")],
			userConfigPath: join(homedir(), ".codex", "lsp-client.json"),
			installDecisionsPath: join(homedir(), ".codex", "lsp-install-decisions.json"),
			capabilities: { installDecisionTool: true },
		});

		expect(context.projectConfigPaths).toEqual([join(root, ".codex", "missing-lsp-client.json")]);
	});

	it("#given symlink project config escaping cwd #when parsed #then rejects the escape", () => {
		const root = tempRoot("lsp-context-symlink-root-");
		const outside = tempRoot("lsp-context-symlink-outside-");
		const outsideConfig = join(outside, "lsp-client.json");
		writeFileSync(outsideConfig, "{}");
		const linkedConfig = join(root, "linked-lsp-client.json");
		symlinkSync(outsideConfig, linkedConfig);

		expect(() =>
			parseLspRequestContext({
				cwd: root,
				projectConfigPaths: [linkedConfig],
				userConfigPath: join(homedir(), ".codex", "lsp-client.json"),
				installDecisionsPath: join(homedir(), ".codex", "lsp-install-decisions.json"),
				capabilities: { installDecisionTool: true },
			}),
		).toThrow(LspRequestContextParseError);
	});

	it("#given standalone MCP env #when translated #then resolves exact defaults and relative paths", () => {
		const root = tempRoot("lsp-context-standalone-");
		const home = tempRoot("lsp-context-home-");
		const absoluteProjectPath = join(root, ".omo", "lsp-client.json");

		const context = createStandaloneMcpRequestContext({
			cwd: root,
			homeDir: home,
			env: {
				LSP_TOOLS_MCP_PROJECT_CONFIG: ["relative.json", "", absoluteProjectPath].join(delimiter),
				LSP_TOOLS_MCP_USER_CONFIG: "user-lsp.json",
				LSP_TOOLS_MCP_INSTALL_DECISIONS: "decisions.json",
			},
		});

		expect(context).toEqual({
			cwd: root,
			projectConfigPaths: [join(root, "relative.json"), absoluteProjectPath],
			userConfigPath: join(home, "user-lsp.json"),
			installDecisionsPath: join(home, "decisions.json"),
			capabilities: { installDecisionTool: true },
		});
	});
});
