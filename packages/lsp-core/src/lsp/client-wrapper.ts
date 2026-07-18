import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	canonicalizeExistingOrNearestAncestor,
	contextCwd,
	isPathInside,
	lspRequestContext,
} from "../request-context.js";
import type { LspClient } from "./client.js";
import { effectiveExtension } from "./effective-extension.js";
import {
	isLspDeadConnectionError,
	LspInvalidPathError,
	LspRequestTimeoutError,
	LspServerInitializingError,
	LspServerLookupError,
} from "./errors.js";
import { getLspManager, type LspManager } from "./manager.js";
import { loadInstallDecision } from "./server-install-state.js";
import { findServerForExtension } from "./server-resolution.js";
import type { ServerLookupResult } from "./types.js";

const WORKSPACE_MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle"];

export function isDirectoryPath(filePath: string): boolean {
	try {
		return statSync(filePath).isDirectory();
	} catch {
		return false;
	}
}

export function findWorkspaceRoot(filePath: string): string {
	const abs = resolvePathInsideContext(filePath);
	let dir = abs;

	if (!isDirectoryPath(dir)) {
		dir = dirname(dir);
	}

	let prevDir = "";
	while (dir !== prevDir) {
		for (const marker of WORKSPACE_MARKERS) {
			if (existsSync(join(dir, marker))) {
				return dir;
			}
		}
		prevDir = dir;
		dir = dirname(dir);
	}

	return dirname(abs);
}

export function resolvePathInsideContext(filePath: string): string {
	const cwd = contextCwd();
	const abs = resolve(cwd, filePath);
	const canonical = canonicalizeExistingOrNearestAncestor(abs);
	if (!isPathInside(cwd, canonical)) {
		throw new LspInvalidPathError(`LSP file path must be inside request cwd: ${filePath}`);
	}
	return canonical;
}

export function formatServerLookupError(result: Exclude<ServerLookupResult, { status: "found" }>): string {
	if (result.status === "not_installed") {
		return formatNotInstalled(result);
	}
	const context = lspRequestContext();
	const firstProjectConfigPath = context.projectConfigPaths[0] ?? "<project lsp config>";

	return [
		`No LSP server configured for extension: ${result.extension}`,
		"",
		`Available servers: ${result.availableServers.slice(0, 10).join(", ")}${
			result.availableServers.length > 10 ? "..." : ""
		}`,
		"",
		`Configure a custom server in '${firstProjectConfigPath}' or '${context.userConfigPath}':`,
		"  {",
		'    "lsp": {',
		'      "my-server": {',
		'        "command": ["my-lsp", "--stdio"],',
		`        "extensions": ["${result.extension}"]`,
		"      }",
		"    }",
		"  }",
	].join("\n");
}

function formatNotInstalled(result: Extract<ServerLookupResult, { status: "not_installed" }>): string {
	const { server, installHint } = result;
	const extensions = server.extensions.join(", ");
	const decision = loadInstallDecision(server.id)?.decision;
	const context = lspRequestContext();

	if (decision === "declined") {
		return `LSP server '${server.id}' (${extensions}) is NOT INSTALLED; user previously declined installation — proceed without LSP.`;
	}

	const header = [
		`LSP server '${server.id}' for ${extensions} is NOT INSTALLED.`,
		"",
		`Command not found: ${server.command[0]}`,
		"",
	];

	if (decision === "allowed") {
		return [
			...header,
			"The user has pre-authorized LSP installation. Run the install command, then retry this tool:",
			`  ${installHint}`,
		].join("\n");
	}

	if (!context.capabilities.installDecisionTool) {
		return [
			...header,
			"To install, run:",
			`  ${installHint}`,
			"",
			"ACTION REQUIRED — ASK THE USER whether to install this LSP server.",
			"Install-decision recording is unavailable in this harness; proceed without LSP if the user declines.",
		].join("\n");
	}

	return [
		...header,
		"To install, run:",
		`  ${installHint}`,
		"",
		"ACTION REQUIRED — ASK THE USER whether to install this LSP server.",
		"- If the user agrees: run the install command above, then retry this tool.",
		"- If the user declines, OR has NOT explicitly asked for LSP installation:",
		`    call lsp_install_decision { server_id: "${server.id}", decision: "declined" },`,
		`    which writes to ${context.installDecisionsPath},`,
		"    then ignore this message and proceed WITHOUT LSP.",
	].join("\n");
}

export interface WithLspClientOptions {
	signal?: AbortSignal;
	manager?: LspManager;
}

const READ_ONLY_RETRY_TOOLS = new Set([
	"diagnostics",
	"definition",
	"references",
	"documentSymbols",
	"workspaceSymbols",
	"prepareRename",
]);

export async function withLspClient<T>(
	filePath: string,
	fn: (client: LspClient, workspaceRoot: string) => Promise<T>,
	toolName: string,
	options: WithLspClientOptions = {},
): Promise<T> {
	const absPath = resolvePathInsideContext(filePath);

	if (isDirectoryPath(absPath)) {
		throw new LspInvalidPathError(
			"Directory paths are not supported by this LSP tool. " +
				"Use lsp.diagnostics with a directory path for directory diagnostics.",
		);
	}

	const ext = effectiveExtension(absPath);
	const result = findServerForExtension(ext);
	if (result.status !== "found") {
		throw new LspServerLookupError(formatServerLookupError(result), result);
	}

	const server = result.server;
	const root = findWorkspaceRoot(absPath);
	const manager = options.manager ?? getLspManager();

	const acquireAndCall = async (allowRetry: boolean): Promise<T> => {
		const client = await manager.getClient(root, server, options.signal);

		try {
			return await fn(client, root);
		} catch (err) {
			if (allowRetry && READ_ONLY_RETRY_TOOLS.has(toolName) && isLspDeadConnectionError(err)) {
				manager.invalidateClient(root, server.id, client);
				return acquireAndCall(false);
			}

			if (err instanceof LspRequestTimeoutError) {
				if (manager.isServerInitializing(root, server.id)) {
					throw new LspServerInitializingError(err);
				}
			}
			throw err;
		} finally {
			manager.releaseClient(root, server.id);
		}
	};

	return acquireAndCall(true);
}
