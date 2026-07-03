import path from "node:path";

export function resolvePatchPath(cwd: string, filePath: string): string {
	return path.resolve(cwd, filePath);
}
