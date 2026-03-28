import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	CONFIG_BASENAME,
	getPluginConfigFileCandidates,
	parseJsonc,
} from "../../shared";
import type { ConfigMergeResult, InstallConfig } from "../types";
import { getConfigDir } from "./config-context";
import { deepMergeRecord } from "./deep-merge-record";
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists";
import { formatErrorWithSuggestion } from "./format-error-with-suggestion";
import { generateOmoConfig } from "./generate-omo-config";

function isEmptyOrWhitespace(content: string): boolean {
	return content.trim().length === 0;
}

function getWritableOmoConfigPath(configDir: string): string {
	const canonicalJsoncPath = join(configDir, `${CONFIG_BASENAME}.jsonc`);
	const canonicalJsonPath = join(configDir, `${CONFIG_BASENAME}.json`);

	if (existsSync(canonicalJsoncPath)) {
		return canonicalJsoncPath;
	}

	if (existsSync(canonicalJsonPath)) {
		return canonicalJsonPath;
	}

	return canonicalJsoncPath;
}

function readFirstValidExistingConfig(
	configDir: string,
): Record<string, unknown> | null {
	for (const candidatePath of getPluginConfigFileCandidates(configDir)) {
		if (!existsSync(candidatePath)) continue;

		try {
			const stat = statSync(candidatePath);
			const content = readFileSync(candidatePath, "utf-8");

			if (stat.size === 0 || isEmptyOrWhitespace(content)) {
				continue;
			}

			const existing = parseJsonc<Record<string, unknown>>(content);
			if (
				!existing ||
				typeof existing !== "object" ||
				Array.isArray(existing)
			) {
				continue;
			}

			return existing;
		} catch (parseErr) {
			if (parseErr instanceof SyntaxError) {
				continue;
			}

			throw parseErr;
		}
	}

	return null;
}

export function writeOmoConfig(
	installConfig: InstallConfig,
): ConfigMergeResult {
	try {
		ensureConfigDirectoryExists();
	} catch (err) {
		return {
			success: false,
			configPath: getConfigDir(),
			error: formatErrorWithSuggestion(err, "create config directory"),
		};
	}

	const configDir = getConfigDir();
	const omoConfigPath = getWritableOmoConfigPath(configDir);

	try {
		const newConfig = generateOmoConfig(installConfig);
		const existing = readFirstValidExistingConfig(configDir);
		const merged = existing ? deepMergeRecord(newConfig, existing) : newConfig;
		writeFileSync(omoConfigPath, JSON.stringify(merged, null, 2) + "\n");

		return { success: true, configPath: omoConfigPath };
	} catch (err) {
		return {
			success: false,
			configPath: omoConfigPath,
			error: formatErrorWithSuggestion(err, "write oh-my-opencode config"),
		};
	}
}
