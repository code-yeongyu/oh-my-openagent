import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { WORKSPACE_MARKERS } from "./workspace-markers.js";

export interface OutsideContextWorkspaceOptions {
	/** Temp roots that never count as a project root themselves; defaults to OS temp dir (plus `/tmp` off Windows). */
	readonly tempDirs?: readonly string[];
	/** Home dirs that never count as a project root themselves; defaults to OS home dir (plus `$HOME`). */
	readonly homeDirs?: readonly string[];
}

/**
 * Read-only tools and post-edit diagnostics accept out-of-cwd files, so cwd cannot bound this search;
 * the fallback keeps the server scoped to the file's own directory.
 *
 * Home and temp roots are never workspace roots themselves: a dotfiles `.git` or stray `~/package.json`
 * or `/tmp/package.json` must not turn the user's entire home or temp directory into an LSP workspace root.
 */
export function findWorkspaceRootOutsideContext(
	directory: string,
	options: OutsideContextWorkspaceOptions = {},
): string {
	const marked = nearestMarkedAncestor(directory);
	const boundaryRoots = nonProjectBoundaryRoots(options);
	if (marked !== undefined && !boundaryRoots.has(marked)) return marked;
	return realpathSync(nearestExistingAncestor(directory));
}

export function nearestMarkedAncestor(directory: string): string | undefined {
	let current = directory;
	for (;;) {
		if (existsSync(current) && WORKSPACE_MARKERS.some((marker) => existsSync(join(current, marker)))) {
			return realpathSync(current);
		}
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function nonProjectBoundaryRoots(options: OutsideContextWorkspaceOptions): ReadonlySet<string> {
	const defaultHomes = [homedir(), process.env["HOME"]].filter(
		(entry): entry is string => typeof entry === "string" && entry.length > 0,
	);
	const defaultTemps = process.platform === "win32" ? [tmpdir()] : [tmpdir(), "/tmp"];
	const candidates = [...(options.homeDirs ?? defaultHomes), ...(options.tempDirs ?? defaultTemps)];
	const canonical = new Set<string>();
	for (const candidate of candidates) {
		const existing = nearestExistingAncestor(candidate);
		if (existsSync(existing) && existing === candidate) {
			canonical.add(realpathSync(existing));
		}
	}
	return canonical;
}

function nearestExistingAncestor(directory: string): string {
	let current = directory;
	while (!existsSync(current)) {
		const parent = dirname(current);
		if (parent === current) return current;
		current = parent;
	}
	return current;
}
