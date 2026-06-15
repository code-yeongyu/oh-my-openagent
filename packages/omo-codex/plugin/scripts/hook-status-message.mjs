const PRODUCT_NAME = "LazyCodex";

const WORD_OVERRIDES = new Map([
	["lazycodex", "LazyCodex"],
	["lsp", "LSP"],
	["mcp", "MCP"],
	["ulw-loop", "Ulw-Loop"],
]);

export function formatLazyCodexHookStatusMessage(version, label) {
	return `${PRODUCT_NAME}(${normalizeVersion(version)}): ${normalizeLazyCodexHookStatusLabel(label)}`;
}

export function normalizeLazyCodexHookStatusLabel(label) {
	const parsed = parseLazyCodexHookStatusMessage(label);
	const rawLabel = parsed === null ? label : parsed.label;
	const normalized = rawLabel.replace(/\bOMO\b/gi, " ").replace(/\s+/g, " ").trim();
	if (normalized.length === 0) return "";
	return normalized
		.split(" ")
		.map(formatWord)
		.join(" ");
}

export function parseLazyCodexHookStatusMessage(message) {
	const match = /^LazyCodex\(([^)]+)\):\s+(.+)$/.exec(message.trim());
	if (match === null) return null;
	const [, version, label] = match;
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
