import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { WorkspaceSnapshotEntry } from "./workspace-edit-types.js";

export type WorkspacePathResult =
	| {
			readonly success: true;
			readonly path: string;
			readonly requestedPath: string;
			readonly followedSymbolicLink: boolean;
		  }
		| { readonly success: false; readonly error: string };

class WorkspaceEditPathError extends Error {
	override readonly name = "WorkspaceEditPathError";

	constructor(
		readonly path: string,
		readonly detail: string,
	) {
		super(`${detail}: ${path}`);
	}
}

export function isPathInsideWorkspace(filePath: string, workspaceRoot: string): boolean {
	const relativePath = relative(workspaceRoot, filePath);
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function canonicalizeMissingPath(filePath: string): string {
	let ancestor = filePath;
	while (!existsSync(ancestor)) {
		const parent = dirname(ancestor);
		if (parent === ancestor) throw new WorkspaceEditPathError(filePath, "no existing ancestor");
		ancestor = parent;
	}
	return resolve(realpathSync(ancestor), relative(ancestor, filePath));
}

export function canonicalWorkspaceRoot(workspaceRoot: string): WorkspacePathResult {
	try {
		const canonical = realpathSync(resolve(workspaceRoot));
		if (!lstatSync(canonical).isDirectory()) {
			return { success: false, error: `workspace root is not a directory: ${workspaceRoot}` };
		}
		return {
			success: true,
			path: canonical,
			requestedPath: resolve(workspaceRoot),
			followedSymbolicLink: existsSync(resolve(workspaceRoot)) && lstatSync(resolve(workspaceRoot)).isSymbolicLink(),
		};
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { success: false, error: `workspace root ${workspaceRoot}: ${detail}` };
	}
}

export function uriToCanonicalWorkspacePath(uri: string, workspaceRoot: string): WorkspacePathResult {
	let requestedPath: string;
	try {
		const parsed = new URL(uri);
		if (parsed.protocol !== "file:" || parsed.search !== "" || parsed.hash !== "") {
			return { success: false, error: `non-file URI ${uri}` };
		}
		requestedPath = resolve(fileURLToPath(parsed));
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { success: false, error: `non-file URI ${uri}: ${detail}` };
	}

	try {
		const canonical = existsSync(requestedPath) ? realpathSync(requestedPath) : canonicalizeMissingPath(requestedPath);
		if (!isPathInsideWorkspace(canonical, workspaceRoot)) {
			return { success: false, error: `${requestedPath}: outside workspace ${workspaceRoot}` };
		}
		return {
			success: true,
			path: canonical,
			requestedPath,
			followedSymbolicLink: existsSync(requestedPath) && lstatSync(requestedPath).isSymbolicLink(),
		};
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { success: false, error: `${requestedPath}: ${detail}` };
	}
}

export function snapshotPath(path: string, includeChildren: boolean): WorkspaceSnapshotEntry {
	if (!existsSync(path)) return { kind: "missing" };
	const stats = lstatSync(path);
	if (stats.isFile()) return { kind: "file", content: readFileSync(path, "utf-8") };
	if (stats.isDirectory()) {
		return includeChildren ? { kind: "directory", children: readdirSync(path).sort() } : { kind: "directory" };
	}
	throw new WorkspaceEditPathError(path, "unsupported filesystem entry");
}
