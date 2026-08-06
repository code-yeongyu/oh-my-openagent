import type { Diagnostic } from "./types.js";

interface ConfigurationItem {
	readonly section?: string;
}

interface DiagnosticsParams {
	readonly uri: string;
	readonly diagnostics: Diagnostic[];
	readonly version?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseConfigurationItems(params: unknown): ConfigurationItem[] {
	if (!isRecord(params) || !Array.isArray(params["items"])) return [];
	const items: ConfigurationItem[] = [];
	for (const item of params["items"]) {
		if (!isRecord(item)) continue;
		const section = item["section"];
		items.push(section === undefined || typeof section !== "string" ? {} : { section });
	}
	return items;
}

export function parseDiagnosticsParams(params: unknown): DiagnosticsParams | null {
	if (!isRecord(params) || typeof params["uri"] !== "string") return null;
	const diagnostics = Array.isArray(params["diagnostics"]) ? params["diagnostics"].filter(isDiagnostic) : [];
	const version = typeof params["version"] === "number" ? params["version"] : undefined;
	return { uri: params["uri"], diagnostics, ...(version === undefined ? {} : { version }) };
}

export function createLspSpawnEnv(
	_root: string,
	input: Record<string, string | undefined>,
): Record<string, string | undefined> {
	return { ...input };
}

function isDiagnostic(value: unknown): value is Diagnostic {
	return isRecord(value) && isRange(value["range"]) && typeof value["message"] === "string";
}

function isRange(value: unknown): value is Diagnostic["range"] {
	return isRecord(value) && isPosition(value["start"]) && isPosition(value["end"]);
}

function isPosition(value: unknown): value is Diagnostic["range"]["start"] {
	return isRecord(value) && typeof value["line"] === "number" && typeof value["character"] === "number";
}
