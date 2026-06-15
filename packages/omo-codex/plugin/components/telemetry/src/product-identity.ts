import { readFileSync } from "node:fs";

import {
	DEFAULT_POSTHOG_API_KEY,
	DEFAULT_POSTHOG_HOST,
	getTelemetryDiagnosticsFilePath,
	resolveTelemetryStateDir,
	writeTelemetryDiagnostic,
	type TelemetryDiagnosticInput,
	type TelemetryProductConfig,
} from "@oh-my-opencode/telemetry-core";

export { DEFAULT_POSTHOG_API_KEY, DEFAULT_POSTHOG_HOST };

export const PRODUCT_NAME = "omo-codex";
export const PACKAGE_NAME = "@oh-my-opencode/omo-codex";
export const CACHE_DIR_NAME = "omo-codex";
export const EVENT_NAME = "omo_codex_daily_active";
export const LEGACY_PARENT_PACKAGE = "oh-my-opencode";
export const PRODUCT_ENV_PREFIX = "OMO_CODEX";
export const MACHINE_ID_PREFIX = "omo-codex:";

type ComponentPackageManifest = { readonly version?: string };

function isComponentPackageManifest(value: unknown): value is ComponentPackageManifest {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readComponentVersionFromManifest(): string {
	try {
		const manifestUrl = new URL("../package.json", import.meta.url);
		const manifestText = readFileSync(manifestUrl, "utf-8");
		const parsed: unknown = JSON.parse(manifestText);
		if (isComponentPackageManifest(parsed) && typeof parsed.version === "string") {
			return parsed.version;
		}
	} catch (error) {
		if (error instanceof Error) {
			return "0.0.0";
		}
		return "0.0.0";
	}
	return "0.0.0";
}

const COMPONENT_VERSION_CACHE = readComponentVersionFromManifest();

export function getComponentVersion(): string {
	return COMPONENT_VERSION_CACHE;
}

export function createComponentTelemetryProductConfig(
	additionalProperties?: TelemetryProductConfig["additionalProperties"],
): TelemetryProductConfig {
	const product = {
		cacheDirName: CACHE_DIR_NAME,
		defaultApiKey: DEFAULT_POSTHOG_API_KEY,
		defaultHost: DEFAULT_POSTHOG_HOST,
		eventName: EVENT_NAME,
		machineIdPrefix: MACHINE_ID_PREFIX,
		packageName: PACKAGE_NAME,
		packageVersion: getComponentVersion(),
		platform: "omo-codex",
		productEnvPrefix: PRODUCT_ENV_PREFIX,
		productName: PRODUCT_NAME,
	};

	if (additionalProperties === undefined) {
		return product;
	}

	return {
		...product,
		additionalProperties,
	};
}

export function getComponentTelemetryStateDir(): string {
	return resolveTelemetryStateDir(createComponentTelemetryProductConfig());
}

export function getComponentTelemetryDiagnosticsFilePath(): string {
	return getTelemetryDiagnosticsFilePath(getComponentTelemetryStateDir());
}

export function writeComponentTelemetryDiagnostic(input: TelemetryDiagnosticInput, now = new Date()): void {
	writeTelemetryDiagnostic(input, {
		diagnosticsDir: getComponentTelemetryStateDir(),
		now,
	});
}
