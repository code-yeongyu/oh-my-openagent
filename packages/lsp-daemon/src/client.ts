import {
	callDiagnosticsViaDaemon as callDiagnosticsViaDaemonInternal,
	callToolViaDaemon as callToolViaDaemonInternal,
	currentRequestContext as currentRequestContextInternal,
} from "./daemon-client.js";
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

export const OMO_LSP_DAEMON_DIR = "OMO_LSP_DAEMON_DIR";
export const OMO_LSP_DAEMON_CLI = "OMO_LSP_DAEMON_CLI";
export const OMO_LSP_DAEMON_VERSION = "OMO_LSP_DAEMON_VERSION";

const DAEMON_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

export type DaemonRuntime = {
	readonly cliPath: string;
	readonly version: string;
};

export type DaemonRuntimeDefaults = DaemonRuntime;

export type InvalidRuntimeOverrideReason =
	| "paired_values_required"
	| "cli_must_be_absolute"
	| "cli_not_found"
	| "cli_not_file"
	| "packaged_cli_must_be_absolute";

export class InvalidRuntimeOverrideError extends Error {
	readonly code = "invalid_runtime_override";
	readonly reason: InvalidRuntimeOverrideReason;

	constructor(reason: InvalidRuntimeOverrideReason, message: string) {
		super(message);
		this.name = "InvalidRuntimeOverrideError";
		this.reason = reason;
	}
}

export function validateDaemonVersion(version: string): string {
	if (!DAEMON_VERSION_PATTERN.test(version)) {
		throw new Error("LSP daemon version must match [A-Za-z0-9][A-Za-z0-9._+-]{0,127}");
	}
	return version;
}

export function resolveDaemonRuntime(
	env: Record<string, string | undefined>,
	defaults: DaemonRuntimeDefaults,
): DaemonRuntime {
	const cliOverride = env[OMO_LSP_DAEMON_CLI];
	const versionOverride = env[OMO_LSP_DAEMON_VERSION];
	const hasCliOverride = cliOverride !== undefined;
	const hasVersionOverride = versionOverride !== undefined;

	if (hasCliOverride !== hasVersionOverride) {
		throw new InvalidRuntimeOverrideError(
			"paired_values_required",
			`${OMO_LSP_DAEMON_CLI} and ${OMO_LSP_DAEMON_VERSION} must be set together`,
		);
	}

	if (!hasCliOverride || !hasVersionOverride) {
		if (!isAbsolute(defaults.cliPath)) {
			throw new InvalidRuntimeOverrideError(
				"packaged_cli_must_be_absolute",
				"Packaged LSP daemon CLI path must be absolute",
			);
		}
		return { cliPath: defaults.cliPath, version: validateDaemonVersion(defaults.version) };
	}

	if (!isAbsolute(cliOverride)) {
		throw new InvalidRuntimeOverrideError(
			"cli_must_be_absolute",
			`${OMO_LSP_DAEMON_CLI} must be an absolute path to an existing regular file`,
		);
	}

	const stat = statSync(cliOverride, { throwIfNoEntry: false });
	if (!stat) {
		throw new InvalidRuntimeOverrideError("cli_not_found", `${OMO_LSP_DAEMON_CLI} points to a missing file`);
	}
	if (!stat.isFile()) {
		throw new InvalidRuntimeOverrideError("cli_not_file", `${OMO_LSP_DAEMON_CLI} must point to a regular file`);
	}

	return { cliPath: cliOverride, version: validateDaemonVersion(versionOverride) };
}

export type LspRequestCapabilities = {
	readonly installDecisionTool: boolean;
};

export type LspRequestContext = {
	readonly cwd: string;
	readonly projectConfigPaths: readonly string[];
	readonly userConfigPath: string;
	readonly installDecisionsPath: string;
	readonly capabilities: LspRequestCapabilities;
};

export type DaemonToolContext = LspRequestContext;

export type CallToolOptions = {
	readonly context: DaemonToolContext;
	readonly requestTimeoutMs?: number;
	readonly signal?: AbortSignal;
};

export type TextContent = {
	readonly type: "text";
	readonly text: string;
};

export type ToolExecutionResult = {
	readonly content: readonly TextContent[];
	readonly isError?: boolean;
	readonly details?: unknown;
};

export type SeverityFilter = "error" | "warning" | "information" | "hint" | "all";

export type LspDiagnosticsDetails = {
	readonly filePath: string;
	readonly severity: SeverityFilter;
	readonly mode: "file" | "directory";
	readonly diagnostics: readonly unknown[];
	readonly totalDiagnostics: number;
	readonly truncated: boolean;
	readonly error?: string;
	readonly errorKind?: "freshness_timeout" | "missing_dependency" | "no_files" | "invalid_path";
	readonly fileFailures?: readonly { readonly file: string; readonly error: string }[];
};

export type LspGotoDefinitionDetails = {
	readonly filePath: string;
	readonly line: number;
	readonly character: number;
	readonly locations: readonly unknown[];
	readonly error?: string;
	readonly errorKind?: "missing_dependency";
};

export type LspFindReferencesDetails = {
	readonly filePath: string;
	readonly line: number;
	readonly character: number;
	readonly references: readonly unknown[];
	readonly totalReferences: number;
	readonly truncated: boolean;
	readonly error?: string;
	readonly errorKind?: "missing_dependency";
};

export type LspSymbolsDetails = {
	readonly filePath: string;
	readonly scope: "document" | "workspace";
	readonly query?: string;
	readonly symbols: readonly unknown[];
	readonly totalSymbols: number;
	readonly truncated: boolean;
	readonly error?: string;
	readonly errorKind?: "missing_dependency" | "missing_query";
};

export type LspPrepareRenameDetails = {
	readonly filePath: string;
	readonly line: number;
	readonly character: number;
	readonly result: unknown;
	readonly error?: string;
	readonly errorKind?: "missing_dependency";
};

export type LspRenameDetails = {
	readonly filePath: string;
	readonly line: number;
	readonly character: number;
	readonly newName: string;
	readonly apply: unknown;
	readonly edit: unknown;
	readonly error?: string;
	readonly errorKind?: "missing_dependency";
};

export function callToolViaDaemon(
	name: string,
	args: Record<string, unknown>,
	options: CallToolOptions,
): Promise<ToolExecutionResult> {
	return callToolViaDaemonInternal(name, args, options);
}

export function callDiagnosticsViaDaemon(
	filePath: string,
	options: CallToolOptions,
): Promise<ToolExecutionResult> {
	return callDiagnosticsViaDaemonInternal(filePath, options);
}

export function currentRequestContext(env: Record<string, string | undefined> = process.env): DaemonToolContext {
	return currentRequestContextInternal(env);
}
