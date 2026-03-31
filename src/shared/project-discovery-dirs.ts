import * as childProcess from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const PROJECT_BOUNDARY_MARKERS = [
	".opencode",
	".claude",
	".agents",
	".sisyphus",
] as const;

function normalizePath(path: string): string {
	const resolvedPath = resolve(path);
	if (!existsSync(resolvedPath)) {
		return resolvedPath;
	}

	try {
		return realpathSync(resolvedPath);
	} catch {
		return resolvedPath;
	}
}

function findAncestorDirectories(
	startDirectory: string,
	targetPaths: ReadonlyArray<ReadonlyArray<string>>,
	stopDirectory?: string,
): string[] {
	const directories: string[] = [];
	const seen = new Set<string>();
	let currentDirectory = normalizePath(startDirectory);
	const resolvedStopDirectory = stopDirectory
		? normalizePath(stopDirectory)
		: undefined;
	const resolvedHomeDirectory = normalizePath(homedir());

	while (true) {
		if (!resolvedStopDirectory && currentDirectory === resolvedHomeDirectory) {
			return directories;
		}

		for (const targetPath of targetPaths) {
			const candidateDirectory = join(currentDirectory, ...targetPath);
			if (!existsSync(candidateDirectory) || seen.has(candidateDirectory)) {
				continue;
			}

			seen.add(candidateDirectory);
			directories.push(candidateDirectory);
		}

		if (!resolvedStopDirectory && existsSync(join(currentDirectory, ".git"))) {
			return directories;
		}

		if (resolvedStopDirectory === currentDirectory) {
			return directories;
		}

		const parentDirectory = dirname(currentDirectory);
		if (parentDirectory === currentDirectory) {
			return directories;
		}

		currentDirectory = normalizePath(parentDirectory);
	}
}

function detectWorktreePath(directory: string): string | undefined {
	try {
		return childProcess
			.execFileSync("git", ["rev-parse", "--show-toplevel"], {
				cwd: directory,
				encoding: "utf-8",
				timeout: 5000,
				stdio: ["pipe", "pipe", "pipe"],
			})
			.trim();
	} catch {
		return undefined;
	}
}

function hasProjectBoundaryMarker(directory: string): boolean {
	return PROJECT_BOUNDARY_MARKERS.some((marker) =>
		existsSync(join(directory, marker)),
	);
}

function findNearestProjectBoundary(directory: string): string | undefined {
	let currentDirectory = normalizePath(directory);

	while (true) {
		if (hasProjectBoundaryMarker(currentDirectory)) {
			return currentDirectory;
		}

		const parentDirectory = dirname(currentDirectory);
		if (parentDirectory === currentDirectory) {
			return undefined;
		}

		currentDirectory = normalizePath(parentDirectory);
	}
}

function detectTempWorkspaceRoot(directory: string): string | undefined {
	const normalizedTempDir = normalizePath(tmpdir());
	let currentDirectory = normalizePath(directory);

	while (true) {
		const parentDirectory = dirname(currentDirectory);
		if (parentDirectory === normalizedTempDir) {
			return currentDirectory;
		}

		if (parentDirectory === currentDirectory) {
			return undefined;
		}

		currentDirectory = normalizePath(parentDirectory);
	}
}

function isNestedBoundary(
	root: string | undefined,
	boundary: string | undefined,
): boolean {
	if (!root || !boundary || root === boundary) {
		return false;
	}

	const relativePath = relative(root, boundary);
	return (
		relativePath !== "" &&
		!relativePath.startsWith("..") &&
		!isAbsolute(relativePath)
	);
}

function resolveDiscoveryStopDirectory(
	startDirectory: string,
): string | undefined {
	const tempWorkspaceRoot = detectTempWorkspaceRoot(startDirectory);
	const nearestBoundary = findNearestProjectBoundary(startDirectory);
	const worktreeRoot = detectWorktreePath(startDirectory);

	if (isNestedBoundary(worktreeRoot, nearestBoundary)) {
		return nearestBoundary;
	}

	if (worktreeRoot) {
		return worktreeRoot;
	}

	if (nearestBoundary) {
		return nearestBoundary;
	}
	return tempWorkspaceRoot ?? undefined;
}

export function findProjectClaudeSkillDirs(
	startDirectory: string,
	stopDirectory?: string,
): string[] {
	return findAncestorDirectories(
		startDirectory,
		[[".claude", "skills"]],
		stopDirectory ?? resolveDiscoveryStopDirectory(startDirectory),
	);
}

export function findProjectAgentsSkillDirs(
	startDirectory: string,
	stopDirectory?: string,
): string[] {
	return findAncestorDirectories(
		startDirectory,
		[[".agents", "skills"]],
		stopDirectory ?? resolveDiscoveryStopDirectory(startDirectory),
	);
}

export function findProjectOpencodeSkillDirs(
	startDirectory: string,
	stopDirectory?: string,
): string[] {
	return findAncestorDirectories(
		startDirectory,
		[
			[".opencode", "skills"],
			[".opencode", "skill"],
		],
		stopDirectory ?? resolveDiscoveryStopDirectory(startDirectory),
	);
}

export function findProjectOpencodeCommandDirs(
	startDirectory: string,
	stopDirectory?: string,
): string[] {
	return findAncestorDirectories(
		startDirectory,
		[
			[".opencode", "commands"],
			[".opencode", "command"],
		],
		stopDirectory ?? resolveDiscoveryStopDirectory(startDirectory),
	);
}
