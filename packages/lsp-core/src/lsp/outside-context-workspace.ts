import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

import { WORKSPACE_MARKERS } from "./workspace-markers.js";

/** Read-only tools accept out-of-cwd files, so cwd cannot bound this search; the fallback keeps the server scoped to the file's own directory. */
export function findWorkspaceRootOutsideContext(directory: string): string {
	const marked = nearestMarkedAncestor(directory);
	if (marked !== undefined) return marked;
	return realpathSync(nearestExistingAncestor(directory));
}

function nearestMarkedAncestor(directory: string): string | undefined {
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

function nearestExistingAncestor(directory: string): string {
	let current = directory;
	while (!existsSync(current)) {
		const parent = dirname(current);
		if (parent === current) return current;
		current = parent;
	}
	return current;
}
