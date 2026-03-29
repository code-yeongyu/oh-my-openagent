import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";

export interface JsoncParseResult<T> {
	data: T | null;
	errors: Array<{ message: string; offset: number; length: number }>;
}

export function parseJsonc<T = unknown>(content: string): T {
	const errors: ParseError[] = [];
	const result = parse(content, errors, {
		allowTrailingComma: true,
		disallowComments: false,
	}) as T;

	if (errors.length > 0) {
		const errorMessages = errors
			.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`)
			.join(", ");
		throw new SyntaxError(`JSONC parse error: ${errorMessages}`);
	}

	return result;
}

export function parseJsoncSafe<T = unknown>(
	content: string,
): JsoncParseResult<T> {
	const errors: ParseError[] = [];
	const data = parse(content, errors, {
		allowTrailingComma: true,
		disallowComments: false,
	}) as T | null;

	return {
		data: errors.length > 0 ? null : data,
		errors: errors.map((e) => ({
			message: printParseErrorCode(e.error),
			offset: e.offset,
			length: e.length,
		})),
	};
}

export function readJsoncFile<T = unknown>(filePath: string): T | null {
	try {
		const content = readFileSync(filePath, "utf-8");
		return parseJsonc<T>(content);
	} catch {
		return null;
	}
}

export function detectConfigFile(basePath: string): {
	format: "json" | "jsonc" | "none";
	path: string;
} {
	const jsoncPath = `${basePath}.jsonc`;
	const jsonPath = `${basePath}.json`;

	if (existsSync(jsoncPath)) {
		return { format: "jsonc", path: jsoncPath };
	}
	if (existsSync(jsonPath)) {
		return { format: "json", path: jsonPath };
	}
	return { format: "none", path: jsonPath };
}

const PLUGIN_CONFIG_NAMES = ["oh-my-openagent", "oh-my-opencode"] as const;

export function getPluginConfigFileCandidates(dir: string): string[] {
	return PLUGIN_CONFIG_NAMES.flatMap((name) => [
		join(dir, `${name}.jsonc`),
		join(dir, `${name}.json`),
	]);
}

export function detectPluginConfigFile(dir: string): {
	format: "json" | "jsonc" | "none";
	path: string;
} {
	const candidates = getPluginConfigFileCandidates(dir);

	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		return {
			format: candidate.endsWith(".jsonc") ? "jsonc" : "json",
			path: candidate,
		};
	}

	return { format: "none", path: candidates[0] };
}

export function readFirstValidPluginConfigFile<T = unknown>(
	dir: string,
): {
	format: "json" | "jsonc" | "none";
	path: string;
	data: T | null;
} {
	const candidates = getPluginConfigFileCandidates(dir);

	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;

		try {
			return {
				format: candidate.endsWith(".jsonc") ? "jsonc" : "json",
				path: candidate,
				data: parseJsonc<T>(readFileSync(candidate, "utf-8")),
			};
		} catch {}
	}

	return { format: "none", path: candidates[0], data: null };
}
