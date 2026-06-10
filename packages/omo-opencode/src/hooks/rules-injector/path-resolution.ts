import { resolve } from "node:path";

export function resolveFilePath(
	workspaceDirectory: string,
	path: string,
): string | null {
	if (!path) return null;
	if (path.startsWith("/")) return path;
	return resolve(workspaceDirectory, path);
}
