import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { OhMyOpenCodeConfigSchema } from "../../../config";
import {
	getOpenCodeConfigDir,
	getPluginConfigFileCandidates,
	migrateConfigFile,
	parseJsonc,
} from "../../../shared";
import { CHECK_IDS, CHECK_NAMES } from "../constants";
import type { CheckResult, DoctorIssue } from "../types";
import { getModelResolutionInfoWithOverrides } from "./model-resolution";
import { loadAvailableModelsFromCache } from "./model-resolution-cache";
import type { OmoConfig } from "./model-resolution-types";

function getUserConfigDir(): string {
	return getOpenCodeConfigDir({ binary: "opencode" });
}

function getProjectConfigDir(): string {
	return join(process.cwd(), ".opencode");
}

interface ConfigValidationResult {
	exists: boolean;
	path: string | null;
	valid: boolean;
	config: OmoConfig | null;
	errors: string[];
	terminal: boolean;
}

function inspectConfigDir(directory: string): ConfigValidationResult {
	let firstExistingPath: string | null = null;
	let fallbackError: string | null = null;

	for (const candidatePath of getPluginConfigFileCandidates(directory)) {
		if (!existsSync(candidatePath)) continue;
		firstExistingPath ??= candidatePath;

		let rawConfig: unknown;
		try {
			rawConfig = parseJsonc<unknown>(readFileSync(candidatePath, "utf-8"));
		} catch (error) {
			fallbackError ??=
				error instanceof Error ? error.message : "Failed to parse config";
			continue;
		}

		if (
			!rawConfig ||
			typeof rawConfig !== "object" ||
			Array.isArray(rawConfig)
		) {
			fallbackError ??= "Plugin config root must be an object";
			continue;
		}

		migrateConfigFile(candidatePath, rawConfig as Record<string, unknown>, {
			persist: false,
		});

		const schemaResult = OhMyOpenCodeConfigSchema.safeParse(rawConfig);
		if (!schemaResult.success) {
			return {
				exists: true,
				path: candidatePath,
				valid: false,
				config: rawConfig as OmoConfig,
				errors: schemaResult.error.issues.map(
					(issue) => `${issue.path.join(".")}: ${issue.message}`,
				),
				terminal: true,
			};
		}

		return {
			exists: true,
			path: candidatePath,
			valid: true,
			config: rawConfig as OmoConfig,
			errors: [],
			terminal: false,
		};
	}

	if (firstExistingPath) {
		return {
			exists: true,
			path: firstExistingPath,
			valid: false,
			config: null,
			errors: [fallbackError ?? "Failed to parse config"],
			terminal: false,
		};
	}

	return {
		exists: false,
		path: null,
		valid: true,
		config: null,
		errors: [],
		terminal: false,
	};
}

function validateConfig(): ConfigValidationResult {
	const projectConfig = inspectConfigDir(getProjectConfigDir());
	if ((projectConfig.exists && projectConfig.valid) || projectConfig.terminal) {
		return projectConfig;
	}

	const userConfig = inspectConfigDir(getUserConfigDir());
	if (userConfig.exists && userConfig.valid) {
		return userConfig;
	}

	if (projectConfig.exists) return projectConfig;
	return userConfig;
}

function collectModelResolutionIssues(config: OmoConfig): DoctorIssue[] {
	const issues: DoctorIssue[] = [];
	const availableModels = loadAvailableModelsFromCache();
	const resolution = getModelResolutionInfoWithOverrides(config);

	const invalidAgentOverrides = resolution.agents.filter(
		(agent) => agent.userOverride && !agent.userOverride.includes("/"),
	);
	const invalidCategoryOverrides = resolution.categories.filter(
		(category) => category.userOverride && !category.userOverride.includes("/"),
	);

	for (const invalidAgent of invalidAgentOverrides) {
		issues.push({
			title: `Invalid agent override: ${invalidAgent.name}`,
			description: `Override '${invalidAgent.userOverride}' must be in provider/model format.`,
			severity: "warning",
			affects: [invalidAgent.name],
		});
	}

	for (const invalidCategory of invalidCategoryOverrides) {
		issues.push({
			title: `Invalid category override: ${invalidCategory.name}`,
			description: `Override '${invalidCategory.userOverride}' must be in provider/model format.`,
			severity: "warning",
			affects: [invalidCategory.name],
		});
	}

	if (availableModels.cacheExists) {
		const providerSet = new Set(availableModels.providers);
		const unknownProviders = [
			...resolution.agents.map((agent) => agent.userOverride),
			...resolution.categories.map((category) => category.userOverride),
		]
			.filter((value): value is string => Boolean(value))
			.map((value) => value.split("/")[0])
			.filter((provider) => provider.length > 0 && !providerSet.has(provider));

		if (unknownProviders.length > 0) {
			const uniqueProviders = [...new Set(unknownProviders)];
			issues.push({
				title: "Model override uses unavailable provider",
				description: `Provider(s) not found in OpenCode model cache: ${uniqueProviders.join(", ")}`,
				severity: "warning",
				affects: ["model resolution"],
			});
		}
	}

	return issues;
}

export async function checkConfig(): Promise<CheckResult> {
	const validation = validateConfig();
	const issues: DoctorIssue[] = [];

	if (!validation.exists) {
		return {
			name: CHECK_NAMES[CHECK_IDS.CONFIG],
			status: "pass",
			message: "No custom config found; defaults are used",
			details: undefined,
			issues,
		};
	}

	if (!validation.valid) {
		issues.push(
			...validation.errors.map((error) => ({
				title: "Invalid configuration",
				description: error,
				severity: "error" as const,
				affects: ["plugin startup"],
			})),
		);

		return {
			name: CHECK_NAMES[CHECK_IDS.CONFIG],
			status: "fail",
			message: `Configuration invalid (${issues.length} issue${issues.length > 1 ? "s" : ""})`,
			details: validation.path ? [`Path: ${validation.path}`] : undefined,
			issues,
		};
	}

	if (validation.config) {
		issues.push(...collectModelResolutionIssues(validation.config));
	}

	return {
		name: CHECK_NAMES[CHECK_IDS.CONFIG],
		status: issues.length > 0 ? "warn" : "pass",
		message:
			issues.length > 0
				? `${issues.length} configuration warning(s)`
				: "Configuration is valid",
		details: validation.path ? [`Path: ${validation.path}`] : undefined,
		issues,
	};
}
