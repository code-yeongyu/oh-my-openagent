import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

export const OMO_LSP_DAEMON_DIR = "OMO_LSP_DAEMON_DIR";
export const OMO_LSP_DAEMON_CLI = "OMO_LSP_DAEMON_CLI";
export const OMO_LSP_DAEMON_VERSION = "OMO_LSP_DAEMON_VERSION";

const DAEMON_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

export interface DaemonRuntime {
	readonly cliPath: string;
	readonly version: string;
}

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

export class InvalidDaemonVersionError extends Error {
	readonly code = "invalid_daemon_version";
	readonly version: string;

	constructor(version: string) {
		super("LSP daemon version must match [A-Za-z0-9][A-Za-z0-9._+-]{0,127}");
		this.name = "InvalidDaemonVersionError";
		this.version = version;
	}
}

export function validateDaemonVersion(version: string): string {
	if (!DAEMON_VERSION_PATTERN.test(version)) throw new InvalidDaemonVersionError(version);
	return version;
}

export function resolveDaemonRuntime(env: NodeJS.ProcessEnv, defaults: DaemonRuntimeDefaults): DaemonRuntime {
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

	let cliStats: ReturnType<typeof statSync>;
	try {
		cliStats = statSync(cliOverride);
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		throw new InvalidRuntimeOverrideError(
			"cli_not_found",
			`${OMO_LSP_DAEMON_CLI} must name an existing regular file`,
		);
	}
	if (!cliStats.isFile()) {
		throw new InvalidRuntimeOverrideError("cli_not_file", `${OMO_LSP_DAEMON_CLI} must name an existing regular file`);
	}

	return { cliPath: cliOverride, version: validateDaemonVersion(versionOverride) };
}
