import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function resolveCodexInstallerBinDir(options = {}) {
	const homeDir = resolve(options.homeDir ?? homedir());
	const env = options.env ?? process.env;
	const explicitBinDir = nonEmptyEnvValue(env, "CODEX_LOCAL_BIN_DIR");
	if (explicitBinDir !== undefined) return explicitBinDir;

	const codexHome = resolve(options.codexHome ?? nonEmptyEnvValue(env, "CODEX_HOME") ?? join(homeDir, ".codex"));
	const defaultCodexHome = resolve(join(homeDir, ".codex"));
	return codexHome === defaultCodexHome ? join(homeDir, ".local", "bin") : join(codexHome, "bin");
}

export function nonEmptyEnvValue(env, key) {
	const value = env[key];
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : trimmed;
}
