const MUTATION_TOOL_NAMES = new Set(["apply_patch", "write", "edit", "multiedit", "multi_edit"]);

export interface MutatedFileInput {
	readonly tool_name?: unknown;
	readonly tool_input?: unknown;
	readonly tool_response?: unknown;
}

export function extractMutatedFilePaths(input: MutatedFileInput): string[] {
	if (!isMutationTool(input.tool_name)) return [];
	if (isFailedToolResponse(input.tool_response)) return [];

	const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
	const paths = new Set<string>();
	addStringValue(paths, toolInput["path"]);
	addStringValue(paths, toolInput["filePath"]);
	addStringValue(paths, toolInput["file_path"]);
	addStringArray(paths, toolInput["paths"]);
	addStringArray(paths, toolInput["filePaths"]);
	addStringArray(paths, toolInput["file_paths"]);
	addPatchPayloads(paths, toolInput);
	addPatchFiles(paths, toolInput["files"]);
	addPatchFiles(paths, toolInput["changes"]);
	return [...paths];
}

function isMutationTool(value: unknown): boolean {
	if (typeof value !== "string") return false;
	return MUTATION_TOOL_NAMES.has(value.toLowerCase());
}

function isFailedToolResponse(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		value["isError"] === true || value["is_error"] === true || value["error"] === true || value["status"] === "error"
	);
}

function addStringValue(paths: Set<string>, value: unknown): void {
	if (typeof value === "string" && value.length > 0) {
		paths.add(value);
	}
}

function addStringArray(paths: Set<string>, value: unknown): void {
	if (!Array.isArray(value)) return;
	for (const item of value) {
		addStringValue(paths, item);
	}
}

function addPatchPayloads(paths: Set<string>, input: Record<string, unknown>): void {
	addPatchInput(paths, input["input"]);
	addPatchInput(paths, input["patch"]);
	addPatchInput(paths, input["command"]);
}

function addPatchInput(paths: Set<string>, value: unknown): void {
	if (typeof value !== "string") return;
	for (const line of value.split("\n")) {
		const path = extractPatchHeaderPath(line);
		if (path !== undefined) paths.add(path);
	}
}

function extractPatchHeaderPath(line: string): string | undefined {
	const prefixes = ["*** Add File: ", "*** Update File: ", "*** Move to: "] as const;
	for (const prefix of prefixes) {
		if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
	}
	return undefined;
}

function addPatchFiles(paths: Set<string>, value: unknown): void {
	if (!Array.isArray(value)) return;
	for (const item of value) {
		if (!isRecord(item)) continue;
		addStringValue(paths, item["path"]);
		addStringValue(paths, item["filePath"]);
		addStringValue(paths, item["file_path"]);
		addStringValue(paths, item["movePath"]);
		addStringValue(paths, item["move_path"]);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
