import type { Settings, SettingsManager } from "../../../settings-manager.ts";
import { parsePermissionPresetName } from "./cli.ts";
import { DEFAULT_PERMISSION_PRESET, fromConfig, merge, rulesForPreset } from "./config.ts";
import { loadApproved } from "./storage.ts";
import type { PermissionConfig, PermissionPresetName, Ruleset } from "./types.ts";

type PermissionSettings = {
	permission?: PermissionConfig;
	permissionPreset?: unknown;
};

/**
 * Load permission settings from global and project settings.json files.
 *
 * Merge order (highest precedence last):
 *   1. Default preset
 *   2. Global preset and rules (~/.senpi/agent/settings.json)
 *   3. Project preset and rules (.senpi/settings.json)
 *   4. CLI preset and rules
 *
 * Runtime approvals are stored separately in .senpi/permissions-approved.jsonl
 * and loaded via loadApproved() from storage.ts.
 */
export function loadPermissionSettings(
	settingsManager: SettingsManager,
	cliOverride: Ruleset,
	projectDir: string,
	cliPresetOverride?: PermissionPresetName,
): { staticRuleset: Ruleset; approved: Ruleset } {
	const globalSettings = settingsManager.getGlobalSettings() as Settings & PermissionSettings;
	const globalPreset = parseSettingsPreset(globalSettings.permissionPreset, "global");
	const globalPresetRuleset = globalPreset ? rulesForPreset(globalPreset) : [];
	const globalRuleset = globalSettings.permission ? fromConfig(globalSettings.permission) : [];

	const projectSettings = settingsManager.getProjectSettings() as Settings & PermissionSettings;
	const projectPreset = parseSettingsPreset(projectSettings.permissionPreset, "project");
	const projectPresetRuleset = projectPreset ? rulesForPreset(projectPreset) : [];
	const projectRuleset = projectSettings.permission ? fromConfig(projectSettings.permission) : [];

	const cliPresetRuleset = cliPresetOverride ? rulesForPreset(cliPresetOverride) : [];
	const staticRuleset = merge(
		rulesForPreset(DEFAULT_PERMISSION_PRESET),
		globalPresetRuleset,
		globalRuleset,
		projectPresetRuleset,
		projectRuleset,
		cliPresetRuleset,
		cliOverride,
	);
	const approved = loadApproved(projectDir);

	return { staticRuleset, approved };
}

function parseSettingsPreset(value: unknown, scope: "global" | "project"): PermissionPresetName | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`Invalid ${scope} permissionPreset ${JSON.stringify(value)}. Expected a string.`);
	}

	const preset = parsePermissionPresetName(value);
	if (!preset) {
		throw new Error(
			`Invalid ${scope} permissionPreset "${value}". Expected one of: full-access, workspace, read-only, ask.`,
		);
	}
	return preset;
}
