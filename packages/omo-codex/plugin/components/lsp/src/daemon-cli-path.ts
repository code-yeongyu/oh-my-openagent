import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const requireFromHere = createRequire(import.meta.url);

const PACKAGE_LSP_DAEMON_CLI = "@code-yeongyu/lsp-daemon/dist/cli.js";
const CODEX_LSP_DAEMON_CLI_ENV = "CODEX_LSP_DAEMON_CLI";
const CODEX_LSP_DAEMON_VERSION_ENV = "CODEX_LSP_DAEMON_VERSION";

interface LspDaemonCliResolution {
	cliPath: string;
	version: string | null;
}

export function ensureLspDaemonCliEnv(env: NodeJS.ProcessEnv = process.env): void {
	const configuredCli = env[CODEX_LSP_DAEMON_CLI_ENV]?.trim();
	const resolution = configuredCli ? resolveConfiguredLspDaemonCli(configuredCli) : resolveLspDaemonCli();
	if (!configuredCli) env[CODEX_LSP_DAEMON_CLI_ENV] = resolution.cliPath;
	if (!env[CODEX_LSP_DAEMON_VERSION_ENV]?.trim() && resolution.version !== null) {
		env[CODEX_LSP_DAEMON_VERSION_ENV] = resolution.version;
	}
}

export function resolveLspDaemonCliPath(): string {
	return resolveLspDaemonCli().cliPath;
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
	} catch {
		return null;
	}
}

function resolveConfiguredLspDaemonCli(cliPath: string): LspDaemonCliResolution {
	return {
		cliPath,
		version: readDaemonPackageVersion(cliPath),
	};
}

function readDaemonPackageVersion(cliPath: string): string | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(dirname(cliPath), "package.json"), "utf8"));
		if (isRecord(parsed) && typeof parsed["version"] === "string" && parsed["version"].length > 0) {
			return parsed["version"];
		}
	} catch {}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
