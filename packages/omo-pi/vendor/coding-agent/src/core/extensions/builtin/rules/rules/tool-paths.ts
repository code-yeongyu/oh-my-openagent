import { isAbsolute, resolve } from "node:path";

import type { ToolResultEvent } from "../../../types.ts";

import { TRACKED_BUILTIN_TOOL_SET } from "./constants.ts";

export function isTrackedTool(toolName: string): boolean {
	return TRACKED_BUILTIN_TOOL_SET.has(toolName);
}

export function extractToolPaths(event: ToolResultEvent, cwd: string): string[] {
	if (event.isError || !isTrackedTool(event.toolName)) {
		return [];
	}

	const filePaths = new Set<string>();

	if (event.toolName === "read" || event.toolName === "edit") {
		addPath(filePaths, getStringProperty(event.details, "filePath"), cwd);
		addPath(filePaths, getStringProperty(event.input, "path"), cwd);
	}

	if (event.toolName === "write") {
		addPath(filePaths, getStringProperty(event.input, "filePath"), cwd);
		addPath(filePaths, getStringProperty(event.input, "path"), cwd);
	}

	return [...filePaths];
}

function addPath(filePaths: Set<string>, filePath: string | undefined, cwd: string): void {
	if (filePath === undefined || filePath.length === 0) {
		return;
	}

	filePaths.add(isAbsolute(filePath) ? filePath : resolve(cwd, filePath));
}

function getStringProperty(value: unknown, propertyName: string): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const propertyValue = value[propertyName];
	return typeof propertyValue === "string" ? propertyValue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
