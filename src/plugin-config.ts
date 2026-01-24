import * as fs from "node:fs";
import * as path from "node:path";

import { type OhMyOpenCodeConfig, OhMyOpenCodeConfigSchema } from "./config";
import { findProjectRoot } from "./hooks/rules-injector/finder";
import {
	addConfigLoadError,
	deepMerge,
	detectConfigFile,
	getOpenCodeConfigDir,
	log,
	migrateConfig,
	migrateConfigFile,
	parseJsonc,
} from "./shared";

export function loadConfigFromPath(
	configPath: string,
): OhMyOpenCodeConfig | null {
	try {
		if (fs.existsSync(configPath)) {
			const content = fs.readFileSync(configPath, "utf-8");
			const rawConfig = parseJsonc<Record<string, unknown>>(content);

			migrateConfigFile(configPath, rawConfig);

			const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig);

			if (!result.success) {
				const errorMsg = result.error.issues
					.map((i) => `${i.path.join(".")}: ${i.message}`)
					.join(", ");
				log(`Config validation error in ${configPath}:`, result.error.issues);
				addConfigLoadError({
					path: configPath,
					error: `Validation error: ${errorMsg}`,
				});
				return null;
			}

			log(`Config loaded from ${configPath}`, { agents: result.data.agents });
			return result.data;
		}
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		log(`Error loading config from ${configPath}:`, err);
		addConfigLoadError({ path: configPath, error: errorMsg });
	}
	return null;
}

export function loadConfigFromContent(
	content: string,
	source: string,
): OhMyOpenCodeConfig | null {
	try {
		const rawConfig = parseJsonc<Record<string, unknown>>(content);

		migrateConfig(rawConfig);

		const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig);

		if (!result.success) {
			const errorMsg = result.error.issues
				.map((i) => `${i.path.join(".")}: ${i.message}`)
				.join(", ");
			log(`Config validation error in ${source}:`, result.error.issues);
			addConfigLoadError({
				path: source,
				error: `Validation error: ${errorMsg}`,
			});
			return null;
		}

		log(`Config loaded from ${source}`, { agents: result.data.agents });
		return result.data;
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		log(`Error loading config from ${source}:`, err);
		addConfigLoadError({ path: source, error: errorMsg });
	}
	return null;
}

function getOhMyOpenCodeConfigDir(): string {
	const envDir = process.env.OH_MY_OPENCODE_CONFIG_DIR?.trim();
	if (envDir) return envDir;
	return getOpenCodeConfigDir({ binary: "opencode" });
}

function getDetectedConfigPath(basePath: string): string {
	const detected = detectConfigFile(basePath);
	return detected.format !== "none" ? detected.path : `${basePath}.json`;
}

function getProjectConfigPaths(directory: string): string[] {
	const resolvedDir = path.resolve(directory);
	const projectRoot =
		findProjectRoot(resolvedDir) ?? path.parse(resolvedDir).root;
	const dirs: string[] = [];
	let current = resolvedDir;

	while (true) {
		dirs.push(current);
		if (current === projectRoot) break;
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}

	dirs.reverse();

	const configPaths: string[] = [];
	for (const dir of dirs) {
		const basePath = path.join(dir, ".opencode", "oh-my-opencode");
		const detected = detectConfigFile(basePath);
		if (detected.format !== "none") {
			configPaths.push(detected.path);
		}
	}

	return configPaths;
}

export function mergeConfigs(
	base: OhMyOpenCodeConfig,
	override: OhMyOpenCodeConfig,
): OhMyOpenCodeConfig {
	return {
		...base,
		...override,
		agents: deepMerge(base.agents, override.agents),
		categories: deepMerge(base.categories, override.categories),
		disabled_agents: [
			...new Set([
				...(base.disabled_agents ?? []),
				...(override.disabled_agents ?? []),
			]),
		],
		disabled_mcps: [
			...new Set([
				...(base.disabled_mcps ?? []),
				...(override.disabled_mcps ?? []),
			]),
		],
		disabled_hooks: [
			...new Set([
				...(base.disabled_hooks ?? []),
				...(override.disabled_hooks ?? []),
			]),
		],
		disabled_commands: [
			...new Set([
				...(base.disabled_commands ?? []),
				...(override.disabled_commands ?? []),
			]),
		],
		disabled_skills: [
			...new Set([
				...(base.disabled_skills ?? []),
				...(override.disabled_skills ?? []),
			]),
		],
		claude_code: deepMerge(base.claude_code, override.claude_code),
	};
}

export function loadPluginConfig(
	directory: string,
	_ctx: unknown,
): OhMyOpenCodeConfig {
	const configDir = getOhMyOpenCodeConfigDir();
	const userBasePath = path.join(configDir, "oh-my-opencode");
	const userConfigPath = getDetectedConfigPath(userBasePath);
	const inlineConfigContent =
		process.env.OH_MY_OPENCODE_CONFIG_CONTENT?.trim() ?? null;
	const envConfigPath = process.env.OH_MY_OPENCODE_CONFIG?.trim() ?? null;

	let config: OhMyOpenCodeConfig = loadConfigFromPath(userConfigPath) ?? {};

	if (envConfigPath) {
		const envConfig = loadConfigFromPath(envConfigPath);
		if (envConfig) {
			config = mergeConfigs(config, envConfig);
		}
	}

	const projectConfigPaths = getProjectConfigPaths(directory);
	for (const projectConfigPath of projectConfigPaths) {
		const projectConfig = loadConfigFromPath(projectConfigPath);
		if (projectConfig) {
			config = mergeConfigs(config, projectConfig);
		}
	}

	if (inlineConfigContent) {
		const inlineConfig = loadConfigFromContent(
			inlineConfigContent,
			"OH_MY_OPENCODE_CONFIG_CONTENT",
		);
		if (inlineConfig) {
			config = mergeConfigs(config, inlineConfig);
		}
	}

	log("Final merged config", {
		agents: config.agents,
		disabled_agents: config.disabled_agents,
		disabled_mcps: config.disabled_mcps,
		disabled_hooks: config.disabled_hooks,
		claude_code: config.claude_code,
	});
	return config;
}
