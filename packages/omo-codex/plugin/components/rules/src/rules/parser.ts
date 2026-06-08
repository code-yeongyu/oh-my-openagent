import { findClosingDelimiter, getOpeningDelimiterLength, stripBom } from "./parser-frontmatter.js";
import { parseYamlFrontmatter } from "./parser-yaml.js";
import type { ParsedRule } from "./types.js";

/** Parse markdown rule content and extract the supported YAML frontmatter subset. */
export function parseRule(content: string): ParsedRule {
	const normalizedContent = stripBom(content);
	const openingLength = getOpeningDelimiterLength(normalizedContent);
	if (openingLength === 0) {
		return { frontmatter: {}, body: normalizedContent };
	}

	const closingDelimiter = findClosingDelimiter(normalizedContent, openingLength);
	if (closingDelimiter === null) {
		return {
			frontmatter: {},
			body: normalizedContent,
			diagnostic: "Missing closing frontmatter delimiter",
		};
	}

	const yamlContent = normalizedContent.slice(openingLength, closingDelimiter.start);
	const body = normalizedContent.slice(closingDelimiter.bodyStart);

	try {
		return { frontmatter: parseYamlFrontmatter(yamlContent), body };
	} catch (error) {
		const message = error instanceof Error ? error.message : "Invalid YAML frontmatter";
		return {
			frontmatter: {},
			body: normalizedContent,
			diagnostic: `Malformed frontmatter: ${message}`,
		};
	}
}
