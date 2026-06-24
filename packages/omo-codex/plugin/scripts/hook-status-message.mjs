const PRODUCT_PREFIX = "(OmO)";

const WORD_OVERRIDES = new Map([
	["codegraph", "CodeGraph"],
	["lazycodex", "LazyCodex"],
	["lsp", "LSP"],
	["mcp", "MCP"],
	["ulw-loop", "Ulw-Loop"],
]);

export function formatLazyCodexHookStatusMessage(version, label) {
	void version;
	return `${PRODUCT_PREFIX} ${normalizeLazyCodexHookStatusLabel(label)}`;
}

export function normalizeLazyCodexHookStatusLabel(label) {
	const parsed = parseLazyCodexHookStatusMessage(label);
	const rawLabel = parsed === null ? label : parsed.label;
	const normalized = rawLabel
		.replace(/^\(OmO\)\s*/i, " ")
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
	const current = /^\(OmO\)\s+(.+)$/.exec(trimmed);
	if (current !== null) return { version: undefined, label: current[1] };
	const legacy = /^LazyCodex\(([^)]+)\):\s+(.+)$/.exec(trimmed);
	if (legacy === null) return null;
	const [, version, label] = legacy;
	return { version, label };
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
