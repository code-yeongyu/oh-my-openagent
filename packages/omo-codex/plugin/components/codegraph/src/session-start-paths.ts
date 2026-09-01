import { basename, dirname, join } from "node:path";

import {
	canonicalizeCodegraphPath,
	resolveCodegraphWorkspacePaths,
} from "../../../../../utils/src/codegraph/paths.ts";

export interface SessionStartStatePaths {
	readonly canonicalProjectRoot: string;
	readonly cooldownPath: string;
	readonly lockPath: string;
	readonly outcomePath: string;
	readonly stateDirectory: string;
}

export function resolveSessionStartStatePaths(homeDir: string, projectRoot: string): SessionStartStatePaths {
	const canonicalProjectRoot = canonicalizeCodegraphPath(projectRoot);
	const workspacePaths = resolveCodegraphWorkspacePaths(canonicalProjectRoot, { homeDir });
	const projectKey = basename(workspacePaths.dataDir);
	const stateDirectory = join(workspacePaths.dataRoot, "session-start");
	return {
		canonicalProjectRoot,
		cooldownPath: join(stateDirectory, "cooldowns", `${projectKey}.json`),
		lockPath: join(stateDirectory, "locks", `${projectKey}.lock`),
		outcomePath: join(workspacePaths.dataRoot, "session-start.jsonl"),
		stateDirectory,
	};
}

export function stateParent(path: string): string {
	return dirname(path);
}
