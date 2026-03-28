import { existsSync, readFileSync } from "node:fs";
import { parseJsonc } from "../../../shared";
import {
	LEGACY_PLUGIN_NAME,
	PLUGIN_NAME,
} from "../../../shared/plugin-identity";
import { CHECK_IDS, CHECK_NAMES, MIN_OPENCODE_VERSION } from "../constants";
import type { CheckResult, DoctorIssue, SystemInfo } from "../types";
import {
	compareVersions,
	findOpenCodeBinary,
	getOpenCodeVersion,
} from "./system-binary";
import {
	getLatestPluginVersion,
	getLoadedPluginVersion,
	getSuggestedInstallTag,
} from "./system-loaded-version";
import { getPluginConfigFileState, getPluginInfo } from "./system-plugin";

function isConfigValid(configPath: string | null): boolean {
	if (!configPath) return true;
	if (!existsSync(configPath)) return false;

	try {
		parseJsonc<Record<string, unknown>>(readFileSync(configPath, "utf-8"));
		return true;
	} catch {
		return false;
	}
}

function getResultStatus(issues: DoctorIssue[]): CheckResult["status"] {
	if (issues.some((issue) => issue.severity === "error")) return "fail";
	if (issues.some((issue) => issue.severity === "warning")) return "warn";
	return "pass";
}

function buildMessage(
	status: CheckResult["status"],
	issues: DoctorIssue[],
): string {
	if (status === "pass") return "System checks passed";
	if (status === "fail") return `${issues.length} system issue(s) detected`;
	return `${issues.length} system warning(s) detected`;
}

export async function gatherSystemInfo(): Promise<SystemInfo> {
	const [binaryInfo, pluginInfo] = await Promise.all([
		findOpenCodeBinary(),
		Promise.resolve(getPluginInfo()),
	]);
	const loadedInfo = getLoadedPluginVersion();

	const opencodeVersion = binaryInfo
		? await getOpenCodeVersion(binaryInfo.path)
		: null;
	const pluginVersion =
		pluginInfo.pinnedVersion ??
		loadedInfo.expectedVersion ??
		loadedInfo.loadedVersion;

	return {
		opencodeVersion,
		opencodePath: binaryInfo?.path ?? null,
		pluginVersion,
		loadedVersion: loadedInfo.loadedVersion,
		bunVersion: Bun.version,
		configPath: pluginInfo.configPath,
		configValid: isConfigValid(pluginInfo.configPath),
		isLocalDev: pluginInfo.isLocalDev,
	};
}

export async function checkSystem(): Promise<CheckResult> {
	const [systemInfo, pluginInfo] = await Promise.all([
		gatherSystemInfo(),
		Promise.resolve(getPluginInfo()),
	]);
	const loadedInfo = getLoadedPluginVersion();
	const pluginConfigFileState = getPluginConfigFileState();
	const latestVersion = await getLatestPluginVersion(systemInfo.loadedVersion);
	const installTag = getSuggestedInstallTag(systemInfo.loadedVersion);
	const issues: DoctorIssue[] = [];

	if (!systemInfo.opencodePath) {
		issues.push({
			title: "OpenCode binary not found",
			description:
				"Install OpenCode CLI or desktop and ensure the binary is available.",
			fix: "Install from https://opencode.ai/docs",
			severity: "error",
			affects: ["doctor", "run"],
		});
	}

	if (
		systemInfo.opencodeVersion &&
		!compareVersions(systemInfo.opencodeVersion, MIN_OPENCODE_VERSION)
	) {
		issues.push({
			title: "OpenCode version below minimum",
			description: `Detected ${systemInfo.opencodeVersion}; required >= ${MIN_OPENCODE_VERSION}.`,
			fix: "Update OpenCode to the latest stable release",
			severity: "warning",
			affects: ["tooling", "doctor"],
		});
	}

	if (!pluginInfo.registered) {
		issues.push({
			title: `${PLUGIN_NAME} is not registered`,
			description: "Plugin entry is missing from OpenCode configuration.",
			fix: `Run: bunx ${PLUGIN_NAME} install`,
			severity: "error",
			affects: ["all agents"],
		});
	}

	if (pluginInfo.entry && !pluginInfo.isLocalDev) {
		const isLegacyName =
			pluginInfo.entry === LEGACY_PLUGIN_NAME ||
			pluginInfo.entry.startsWith(`${LEGACY_PLUGIN_NAME}@`);

		if (isLegacyName) {
			const suggestedEntry = pluginInfo.entry.replace(
				LEGACY_PLUGIN_NAME,
				PLUGIN_NAME,
			);
			issues.push({
				title: "Using legacy package name",
				description: `Your opencode.json references "${LEGACY_PLUGIN_NAME}" which has been renamed to "${PLUGIN_NAME}". The old name may stop working in a future release.`,
				fix: `Update your opencode.json plugin entry: "${pluginInfo.entry}" → "${suggestedEntry}"`,
				severity: "warning",
				affects: ["plugin loading"],
			});
		}
	}

	if (pluginConfigFileState.hasMultipleCanonical) {
		issues.push({
			title: "Multiple canonical config files coexist",
			description: `Detected multiple canonical OMO config files: ${pluginConfigFileState.canonicalPaths.join(", ")}. The runtime prefers "${pluginConfigFileState.canonicalJsoncPath}", but keeping both canonical files can make edits land in the wrong file.`,
			fix: `Keep only one canonical config file, preferably "${pluginConfigFileState.canonicalJsoncPath}", and remove the extra canonical file(s): ${pluginConfigFileState.canonicalPaths.filter((path) => path !== pluginConfigFileState.canonicalJsoncPath).join(", ")}`,
			severity: "warning",
			affects: ["plugin loading", "doctor"],
		});
	}

	if (pluginConfigFileState.hasCanonical && pluginConfigFileState.hasLegacy) {
		issues.push({
			title: "Canonical and legacy config files coexist",
			description: `Detected canonical config "${pluginConfigFileState.canonicalPath}" and legacy config file(s): ${pluginConfigFileState.legacyPaths.join(", ")}. The canonical file wins, but keeping both files can cause confusion during migration.`,
			fix: `Review both files, keep "${pluginConfigFileState.canonicalPath}" as the source of truth, and remove legacy file(s): ${pluginConfigFileState.legacyPaths.join(", ")}`,
			severity: "warning",
			affects: ["plugin loading", "doctor"],
		});
	}

	if (!pluginConfigFileState.hasCanonical && pluginConfigFileState.hasLegacy) {
		issues.push({
			title: "Using legacy config filename",
			description: `Detected legacy OMO config file(s): ${pluginConfigFileState.legacyPaths.join(", ")}. Legacy files still load for compatibility, but the canonical config path is "${pluginConfigFileState.canonicalJsoncPath}".`,
			fix: `Move or copy your OMO config to "${pluginConfigFileState.canonicalJsoncPath}" and remove legacy file(s) once verified.`,
			severity: "warning",
			affects: ["plugin loading", "doctor"],
		});
	}

	if (
		loadedInfo.expectedVersion &&
		loadedInfo.loadedVersion &&
		loadedInfo.expectedVersion !== loadedInfo.loadedVersion
	) {
		issues.push({
			title: "Loaded plugin version mismatch",
			description: `Cache expects ${loadedInfo.expectedVersion} but loaded ${loadedInfo.loadedVersion}.`,
			fix: `Reinstall: cd "${loadedInfo.cacheDir}" && bun install`,
			severity: "warning",
			affects: ["plugin loading"],
		});
	}

	if (
		systemInfo.loadedVersion &&
		latestVersion &&
		!compareVersions(systemInfo.loadedVersion, latestVersion)
	) {
		issues.push({
			title: "Loaded plugin is outdated",
			description: `Loaded ${systemInfo.loadedVersion}, latest ${latestVersion}.`,
			fix: `Update: cd "${loadedInfo.cacheDir}" && bun add ${PLUGIN_NAME}@${installTag}`,
			severity: "warning",
			affects: ["plugin features"],
		});
	}

	const status = getResultStatus(issues);
	return {
		name: CHECK_NAMES[CHECK_IDS.SYSTEM],
		status,
		message: buildMessage(status, issues),
		details: [
			systemInfo.opencodeVersion
				? `OpenCode: ${systemInfo.opencodeVersion}`
				: "OpenCode: not detected",
			`Plugin expected: ${systemInfo.pluginVersion ?? "unknown"}`,
			`Plugin loaded: ${systemInfo.loadedVersion ?? "unknown"}`,
			`Bun: ${systemInfo.bunVersion ?? "unknown"}`,
		],
		issues,
	};
}
