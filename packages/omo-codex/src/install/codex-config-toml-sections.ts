import { scanTomlLines } from "./toml-lexical-lines";
import { parseTomlDottedKey } from "./toml-section-editor";

export interface TomlSection {
	readonly header: string | null;
	readonly text: string;
}

export function removeTomlSections(
	config: string,
	shouldRemove: (header: string, section: TomlSection) => boolean,
): string {
	return splitTomlSections(config)
		.filter(
			(section) =>
				section.header === null || !shouldRemove(section.header, section),
		)
		.map((section) => section.text)
		.join("")
		.replace(/\n{3,}/g, "\n\n");
}

export function splitTomlSections(config: string): readonly TomlSection[] {
	const sections: TomlSection[] = [];
	let current: TomlSection = { header: null, text: "" };
	for (const line of scanTomlLines(config)) {
		const header = parseTomlHeader(line.tableHeader);
		if (header !== null) {
			if (current.text.length > 0) sections.push(current);
			current = { header, text: line.text };
		} else {
			current = { ...current, text: current.text + line.text };
		}
	}
	if (current.text.length > 0) sections.push(current);
	return sections;
}

export function parsePluginHeaderKey(header: string): string | null {
	const path = parseTomlDottedKey(header);
	return path?.[0] === "plugins" ? (path[1] ?? null) : null;
}

export function parseAgentHeaderName(header: string): string | null {
	const path = parseTomlDottedKey(header);
	return path?.[0] === "agents" ? (path[1] ?? null) : null;
}

export function parseJsonString(value: string): string | null {
	try {
		const parsed: unknown = JSON.parse(value);
		return typeof parsed === "string" ? parsed : null;
	} catch {
		return null;
	}
}

export function parseHookStateHeaderKey(header: string): string | null {
	const path = parseTomlDottedKey(header);
	if (path?.[0] !== "hooks" || path[1] !== "state") return null;
	return path[2] ?? null;
}

function parseTomlHeader(line: string | null): string | null {
	if (line === null) return null;
	const trimmed = line.trim();
	if (
		!trimmed.startsWith("[") ||
		!trimmed.endsWith("]") ||
		trimmed.startsWith("[[")
	)
		return null;
	return trimmed.slice(1, -1);
}
