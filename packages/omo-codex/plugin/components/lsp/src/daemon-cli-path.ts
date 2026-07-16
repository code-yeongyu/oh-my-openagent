import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	OMO_LSP_DAEMON_CLI,
	OMO_LSP_DAEMON_VERSION,
	resolveDaemonRuntime,
} from "@code-yeongyu/lsp-daemon/client";

const requireFromHere = createRequire(import.meta.url);

const PACKAGE_LSP_DAEMON_CLI = "@code-yeongyu/lsp-daemon/cli";

interface LspDaemonCliResolution {
	cliPath: string;
	version: string;
}

export function ensureLspDaemonCliEnv(env: NodeJS.ProcessEnv = process.env): void {
	const runtime = resolveDaemonRuntime(env, resolveLspDaemonCli());
	env[OMO_LSP_DAEMON_CLI] = runtime.cliPath;
	env[OMO_LSP_DAEMON_VERSION] = runtime.version;
}

export function resolveLspDaemonCliPath(env: NodeJS.ProcessEnv = process.env): string {
	const runtime = resolveDaemonRuntime(env, resolveLspDaemonCli());
	if (env[OMO_LSP_DAEMON_CLI] === undefined) env[OMO_LSP_DAEMON_CLI] = runtime.cliPath;
	if (env[OMO_LSP_DAEMON_VERSION] === undefined) env[OMO_LSP_DAEMON_VERSION] = runtime.version;
	return runtime.cliPath;
}

function resolveLspDaemonCli(): LspDaemonCliResolution {
	const packageCli = resolvePackageLspDaemonCliPath();
	if (packageCli !== null) return resolveConfiguredLspDaemonCli(packageCli);
	const bundledCli = fileURLToPath(new URL("../../lsp-daemon/dist/cli.js", import.meta.url));
	if (existsSync(bundledCli)) return resolveConfiguredLspDaemonCli(bundledCli);
	return resolveConfiguredLspDaemonCli(bundledCli);
}

function resolvePackageLspDaemonCliPath(): string | null {
	try {
		return requireFromHere.resolve(PACKAGE_LSP_DAEMON_CLI);
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		return null;
	}
}

function resolveConfiguredLspDaemonCli(cliPath: string): LspDaemonCliResolution {
	const version = readDaemonPackageVersion(cliPath);
	if (version === null) {
		throw new Error(`Unable to determine packaged LSP daemon version beside ${cliPath}`);
	}
	return {
		cliPath,
		version,
	};
}

function readDaemonPackageVersion(cliPath: string): string | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(dirname(cliPath), "package.json"), "utf8"));
		if (isRecord(parsed) && typeof parsed["version"] === "string" && parsed["version"].length > 0) {
			return parsed["version"];
		}
	} catch (error) {
		if (!(error instanceof Error)) throw error;
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
