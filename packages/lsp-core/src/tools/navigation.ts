import { DEFAULT_MAX_REFERENCES } from "../lsp/constants.js";
import { formatLocation } from "../lsp/formatters.js";
import { withLspClient } from "../lsp/client-wrapper.js";
import { missingDependencyResult } from "../missing-dependency-result.js";
import { clientOptions, optionalBoolean, requireNumber, requireString } from "./parameters.js";
import { text } from "./result.js";
import type { LspFindReferencesDetails, LspGotoDefinitionDetails, ToolExecutionResult } from "./types.js";

export async function executeLspGotoDefinition(
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ToolExecutionResult> {
	const filePath = requireString(params, "filePath");
	const line = requireNumber(params, "line");
	const character = requireNumber(params, "character");

	try {
		const result = await withLspClient(
			filePath,
			async (client) => client.definition(filePath, line, character),
			"definition",
			clientOptions(signal),
		);
		const locations = !result ? [] : Array.isArray(result) ? result : [result];
		const details: LspGotoDefinitionDetails = { filePath, line, character, locations };
		if (locations.length === 0) return text("No definition found", details);
		return text(locations.map(formatLocation).join("\n"), details);
	} catch (error) {
		const missingDependency = missingDependencyResult(error, {
			filePath,
			line,
			character,
			locations: [],
		} satisfies Omit<LspGotoDefinitionDetails, "error" | "errorKind">);
		if (missingDependency) return missingDependency;
		throw error;
	}
}

export async function executeLspFindReferences(
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ToolExecutionResult> {
	const filePath = requireString(params, "filePath");
	const line = requireNumber(params, "line");
	const character = requireNumber(params, "character");
	const includeDeclaration = optionalBoolean(params, "includeDeclaration") ?? true;

	try {
		const result = await withLspClient(
			filePath,
			async (client) => client.references(filePath, line, character, includeDeclaration),
			"references",
			clientOptions(signal),
		);
		const references = Array.isArray(result) ? result : [];
		const total = references.length;
		const truncated = total > DEFAULT_MAX_REFERENCES;
		const limited = truncated ? references.slice(0, DEFAULT_MAX_REFERENCES) : references;
		const details: LspFindReferencesDetails = {
			filePath,
			line,
			character,
			references,
			totalReferences: total,
			truncated,
		};
		if (total === 0) return text("No references found", details);
		const output = [
			...(truncated ? [`Found ${total} references (showing first ${DEFAULT_MAX_REFERENCES}):`] : []),
			...limited.map(formatLocation),
		].join("\n");
		return text(output, details);
	} catch (error) {
		const missingDependency = missingDependencyResult(error, {
			filePath,
			line,
			character,
			references: [],
			totalReferences: 0,
			truncated: false,
		} satisfies Omit<LspFindReferencesDetails, "error" | "errorKind">);
		if (missingDependency) return missingDependency;
		throw error;
	}
}
