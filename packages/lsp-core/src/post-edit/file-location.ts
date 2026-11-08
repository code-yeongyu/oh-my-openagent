import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { nearestMarkedAncestor } from "../lsp/outside-context-workspace.js";
import { canonicalizeExistingOrNearestAncestor, isPathInside } from "../request-context.js";

export type PostEditFileLocation = "project" | "outside_project" | "agent_config" | "temp";

export interface PostEditFileLocationOptions {
	readonly cwd: string;
	readonly agentDirs: readonly string[];
	/** Temp roots; defaults to the canonical OS temp dir (plus `/tmp` off Windows). */
	readonly tempDirs?: readonly string[];
	/** Home dirs that never count as a project root themselves; defaults to the OS home dir. */
	readonly homeDirs?: readonly string[];
}

/**
 * Classifies an edited file for install guidance.
 *
 * A project root is the nearest ancestor carrying one of lsp-core's `WORKSPACE_MARKERS` (the marker set the
 * out-of-cwd workspace resolver uses). Inside a temp dir, only a marked root strictly below the temp root
 * counts, so a stray `package.json` left in the temp root does not turn every scratch file into a project.
 * The home dir is never a project root either: a dotfiles `.git` or stray `~/package.json` there does not make
 * every home-level file a project, while a marked project below home still is one.
 * Paths are canonicalized first because macOS `/tmp` and `/var` are symlinks.
 */
export function classifyPostEditFileLocation(
	filePath: string,
	options: PostEditFileLocationOptions,
): PostEditFileLocation {
	const file = canonicalizeExistingOrNearestAncestor(resolve(options.cwd, filePath));
	if (canonicalDirectories(options.agentDirs).some((directory) => isPathInside(directory, file))) {
		return "agent_config";
	}

	const projectRoot = nearestMarkedAncestor(dirname(file));
	const tempRoot = canonicalDirectories(options.tempDirs ?? defaultTempDirectories()).find((directory) =>
		isPathInside(directory, file),
	);
	if (tempRoot !== undefined) {
		const ownProject = projectRoot !== undefined && projectRoot !== tempRoot && isPathInside(tempRoot, projectRoot);
		return ownProject ? "project" : "temp";
	}
	if (projectRoot === undefined) return "outside_project";
	return canonicalDirectories(options.homeDirs ?? [homedir()]).includes(projectRoot) ? "outside_project" : "project";
}

function defaultTempDirectories(): readonly string[] {
	return process.platform === "win32" ? [tmpdir()] : [tmpdir(), "/tmp"];
}

function canonicalDirectories(directories: readonly string[]): readonly string[] {
	return directories.map((directory) => canonicalizeExistingOrNearestAncestor(directory));
}
