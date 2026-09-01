const PRODUCT_NAME = "OmO";

const WORD_OVERRIDES = new Map([
	["codegraph", "CodeGraph"],
	["lazycodex", "LazyCodex"],
	["lsp", "LSP"],
	["mcp", "MCP"],
	["ulw-loop", "Ulw-Loop"],
]);

export function formatLazyCodexHookStatusMessage(version, label) {
	return `(${PRODUCT_NAME} ${normalizeVersion(version)}) ${normalizeLazyCodexHookStatusLabel(label)}`;
}

export function normalizeLazyCodexHookStatusLabel(label) {
	const parsed = parseLazyCodexHookStatusMessage(label);
	const rawLabel = parsed === null ? label : parsed.label;
	const normalized = rawLabel
		.replace(/^\(OmO(?:\s+[^)]+)?\)\s*/i, " ")
		.replace(/\bOMO\b/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (normalized.length === 0) return "";
	return normalized
		.split(" ")
		.map(formatWord)
		.join(" ");
}

export function parseLazyCodexHookStatusMessage(message) {
	const trimmed = message.trim();
	const current = /^\(OmO(?:\s+([^)]+))?\)\s+(.+)$/.exec(trimmed);
	if (current !== null) return { version: current[1], label: current[2] };
	const legacy = /^LazyCodex\(([^)]+)\):\s+(.+)$/.exec(trimmed);
	if (legacy === null) return null;
	const [, version, label] = legacy;
	return { version, label };
}

function normalizeVersion(version) {
	const normalized = version.trim();
	return normalized.length === 0 ? "local" : normalized;
}

function formatWord(word) {
	const lower = word.toLowerCase();
	const override = WORD_OVERRIDES.get(lower);
	if (override !== undefined) return override;
	if (word.includes("-")) {
		return word
			.split("-")
			.map(formatWord)
			.join("-");
	}
	return `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
}
