import { readFileSync } from "node:fs";

export const PRODUCT_NAME = "omo-codex";
export const PACKAGE_NAME = "@oh-my-opencode/omo-codex";
export const CACHE_DIR_NAME = "omo-codex";
export const EVENT_NAME = "omo_codex_daily_active";
export const LEGACY_PARENT_PACKAGE = "oh-my-opencode";
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
export const DEFAULT_POSTHOG_API_KEY = "phc_CFJhj5HyvA62QPhvyaUCtaq23aUfznnijg5VaaGkNk74";

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
	} catch {
		return "0.0.0";
	}
	return "0.0.0";
}

const COMPONENT_VERSION_CACHE = readComponentVersionFromManifest();

export function getComponentVersion(): string {
	return COMPONENT_VERSION_CACHE;
}
