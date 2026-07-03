import { extractPatchedPaths } from "../gpt-apply-patch/index.ts";
import { BashArity } from "../permission-system/arity.ts";
import { extractExternalPaths, isExternalPath } from "../permission-system/external-dir.ts";
import type { Request } from "../permission-system/types.ts";

/** Simplified permission request without ID/session metadata */
export type PermissionRequest = Pick<Request, "permission" | "patterns" | "always">;

/** Parser function that extracts permission requests from tool input */
export type ToolPermissionParser = (
	toolName: string,
	input: Record<string, unknown>,
	cwd: string,
) => PermissionRequest[];

function fallbackPermissionRequest(permission: string): PermissionRequest {
	return {
		permission,
		patterns: ["*"],
		always: ["*"],
	};
}

function getString(input: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "string") {
			return value;
		}
	}
	return undefined;
}

type AlwaysScope = "file" | "directory";

function toParentDirectoryPattern(inputPath: string, scope: AlwaysScope): string {
	if (inputPath === "~" || inputPath === "$HOME") {
		return `${inputPath}/*`;
	}

	if (scope === "directory") {
		return inputPath.endsWith("/") || inputPath.endsWith("\\") ? `${inputPath}*` : `${inputPath}/*`;
	}

	if (inputPath.endsWith("/") || inputPath.endsWith("\\")) {
		return `${inputPath}*`;
	}

	const parentPattern = inputPath.replace(/[\\/][^\\/]+$/, "/*");
	if (parentPattern === "/*") {
		return inputPath;
	}
	return parentPattern;
}

function parseFilePath(input: Record<string, unknown>): string | undefined {
	return getString(input, "path", "file_path");
}

function withExternalDirectoryRequests(
	requests: PermissionRequest[],
	paths: string[],
	cwd: string,
	scope: AlwaysScope,
): PermissionRequest[] {
	const externalPaths = paths.filter((inputPath) => isExternalPath(inputPath, cwd));
	if (externalPaths.length === 0) {
		return requests;
	}

	return [
		...requests,
		{
			permission: "external_directory",
			patterns: externalPaths,
			always: externalPaths.map((externalPath) => toParentDirectoryPattern(externalPath, scope)),
		},
	];
}

/** Registry for tool-specific permission parsers */
export class ParserRegistry {
	private readonly parsers = new Map<string, ToolPermissionParser>();

	/** Register a parser for a specific tool */
	register(toolName: string, parser: ToolPermissionParser): void {
		this.parsers.set(toolName, parser);
	}

	/** Parse tool input into permission requests */
	parse(toolName: string, input: Record<string, unknown>, cwd: string): PermissionRequest[] {
		const parser = this.parsers.get(toolName);
		if (!parser) {
			return [fallbackPermissionRequest(toolName)];
		}
		return parser(toolName, input, cwd);
	}
}

/** Create registry with built-in parsers for standard tools */
export function createBuiltinParserRegistry(): ParserRegistry {
	const registry = new ParserRegistry();

	registry.register("bash", (_toolName, input, cwd) => {
		const command = getString(input, "command");
		if (!command) {
			return [fallbackPermissionRequest("bash")];
		}

		const tokens = command.split(/\s+/).filter(Boolean);
		const prefix = BashArity.prefix(tokens).join(" ");
		const always = prefix ? [prefix, `${prefix} *`] : ["*"];
		const requests: PermissionRequest[] = [
			{
				permission: "bash",
				patterns: [prefix || command],
				always,
			},
		];

		const externalPaths = extractExternalPaths(command, cwd);
		if (externalPaths.length > 0) {
			requests.push({
				permission: "external_directory",
				patterns: externalPaths,
				always: externalPaths.map((externalPath) => toParentDirectoryPattern(externalPath, "file")),
			});
		}

		return requests;
	});

	const editParser: ToolPermissionParser = () => {
		return [fallbackPermissionRequest("edit")];
	};

	const parseEditPermission: ToolPermissionParser = (_toolName, input, cwd) => {
		const filePath = parseFilePath(input);
		if (filePath) {
			return withExternalDirectoryRequests(
				[
					{
						permission: "edit",
						patterns: [filePath],
						always: [filePath],
					},
				],
				[filePath],
				cwd,
				"file",
			);
		}

		const patchText = getString(input, "input", "patchText");
		if (!patchText) {
			return editParser("edit", input, "");
		}

		const patchedPaths = extractPatchedPaths(patchText);
		if (patchedPaths.length === 0) {
			return editParser("edit", input, "");
		}

		const editRequests = patchedPaths.map((patchedPath) => ({
			permission: "edit",
			patterns: [patchedPath],
			always: [patchedPath],
		}));

		return withExternalDirectoryRequests(editRequests, patchedPaths, cwd, "file");
	};

	registry.register("edit", parseEditPermission);
	registry.register("write", parseEditPermission);
	registry.register("apply_patch", parseEditPermission);
	registry.register("multiedit", parseEditPermission);

	registry.register("read", (_toolName, input, cwd) => {
		const filePath = parseFilePath(input);
		if (!filePath) {
			return [fallbackPermissionRequest("read")];
		}

		return withExternalDirectoryRequests(
			[
				{
					permission: "read",
					patterns: [filePath],
					always: [filePath],
				},
			],
			[filePath],
			cwd,
			"file",
		);
	});

	registry.register("grep", (_toolName, input, cwd) => {
		const searchPath = getString(input, "path");
		const pattern = getString(input, "pattern");
		const permissionPattern = searchPath ?? pattern;
		if (!permissionPattern) {
			return [fallbackPermissionRequest("grep")];
		}

		const grepRequests: PermissionRequest[] = [
			{
				permission: "grep",
				patterns: [permissionPattern],
				always: ["*"],
			},
		];
		return searchPath ? withExternalDirectoryRequests(grepRequests, [searchPath], cwd, "directory") : grepRequests;
	});

	const listParser: ToolPermissionParser = (_toolName, input, cwd) => {
		const searchPath = getString(input, "path") ?? ".";
		return withExternalDirectoryRequests(
			[
				{
					permission: "list",
					patterns: [searchPath],
					always: [searchPath],
				},
			],
			[searchPath],
			cwd,
			"directory",
		);
	};

	registry.register("find", listParser);
	registry.register("ls", listParser);

	return registry;
}
