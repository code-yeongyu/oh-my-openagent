import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, relative, resolve } from "node:path";

import {
	GLOBAL_DISTANCE,
	PROJECT_RULE_SUBDIRS,
	PROJECT_SINGLE_FILES,
	USER_HOME_RULE_SUBDIRS,
	USER_HOME_SINGLE_FILES,
} from "./constants.js";
import { UnsupportedRuleSourceError } from "./errors.js";
import { scanRuleFiles } from "./scanner.js";
import type { RuleCandidate, RuleSource } from "./types.js";

interface SingleFileInfo {
	path: string;
	realPath: string;
}

export interface RuleDiscoveryCache {
	scannedRuleFiles: Map<string, ReturnType<typeof scanRuleFiles>>;
	singleFileInfo: Map<string, SingleFileInfo | null>;
}

export interface FinderOptions {
	/** Project root absolute path (use findProjectRoot to get this). */
	projectRoot: string | null;
	/** Target file path (used for distance calculation in dynamic injection mode). null for static mode. */
	targetFile: string | null;
	/** User home directory (default: os.homedir()). Injectable for tests. */
	homeDir?: string;
	/** Set of disabled sources to omit from discovery. Empty by default. */
	disabledSources?: ReadonlySet<string>;
	/** Whether to skip user-home rules. Default: false. */
	skipUserHome?: boolean;
	cache?: RuleDiscoveryCache;
}

interface WalkDirectory {
	directory: string;
	distance: number;
}

export function createRuleDiscoveryCache(): RuleDiscoveryCache {
	return { scannedRuleFiles: new Map(), singleFileInfo: new Map() };
}

export function findRuleCandidates(options: FinderOptions): RuleCandidate[] {
	const skipUserHome = options.skipUserHome ?? false;
	if (options.projectRoot === null && skipUserHome) {
		return [];
	}

	const disabledSources = options.disabledSources ?? new Set<string>();
	const candidates: RuleCandidate[] = [];
	const homeDirectory = resolve(options.homeDir ?? homedir());

	if (options.projectRoot !== null) {
		candidates.push(
			...findProjectCandidates(options.projectRoot, options.targetFile, disabledSources, options.cache),
		);
	}

	if (!skipUserHome) {
		candidates.push(...findUserHomeCandidates(homeDirectory, disabledSources, options.cache));
	}

	return candidates;
}

function findProjectCandidates(
	projectRoot: string,
	targetFile: string | null,
	disabledSources: ReadonlySet<string>,
	cache: RuleDiscoveryCache | undefined,
): RuleCandidate[] {
	const rootDirectory = resolve(projectRoot);
	const walkDirectories = getWalkDirectories(rootDirectory, targetFile);
	const candidates: RuleCandidate[] = [];

	for (const walkDirectory of walkDirectories) {
		for (const [parentDirectory, subDirectory] of PROJECT_RULE_SUBDIRS) {
			const source = toProjectRuleSource(parentDirectory, subDirectory);
			if (disabledSources.has(source)) {
				continue;
			}

			const ruleDirectory = join(walkDirectory.directory, parentDirectory, subDirectory);
			for (const scannedFile of scanRuleFilesCached(ruleDirectory, cache)) {
				candidates.push({
					path: scannedFile.path,
					realPath: scannedFile.realPath,
					source,
					distance: targetFile === null ? 0 : walkDirectory.distance,
					isGlobal: false,
					isSingleFile: false,
					relativePath: toRelativePath(rootDirectory, scannedFile.path),
				});
			}
		}
	}

	for (const walkDirectory of walkDirectories) {
		for (const ruleFile of PROJECT_SINGLE_FILES) {
			const source = toProjectSingleFileSource(ruleFile);
			if (disabledSources.has(source)) {
				continue;
			}

			const filePath = join(walkDirectory.directory, ruleFile);
			const fileInfo = singleFileInfoCached(filePath, cache);
			if (fileInfo === null) {
				continue;
			}

			candidates.push({
				path: fileInfo.path,
				realPath: fileInfo.realPath,
				source,
				distance: targetFile === null ? 0 : walkDirectory.distance,
				isGlobal: false,
				isSingleFile: true,
				relativePath: toRelativePath(rootDirectory, filePath),
			});
		}
	}

	return candidates;
}

function findUserHomeCandidates(
	homeDirectory: string,
	disabledSources: ReadonlySet<string>,
	cache: RuleDiscoveryCache | undefined,
): RuleCandidate[] {
	const candidates: RuleCandidate[] = [];

	for (const ruleSubdir of USER_HOME_RULE_SUBDIRS) {
		const source = toUserHomeRuleSource(ruleSubdir);
		if (disabledSources.has(source)) {
			continue;
		}

		const ruleDirectory = join(homeDirectory, ruleSubdir);
		for (const scannedFile of scanRuleFilesCached(ruleDirectory, cache)) {
			candidates.push({
				path: scannedFile.path,
				realPath: scannedFile.realPath,
				source,
				distance: GLOBAL_DISTANCE,
				isGlobal: true,
				isSingleFile: false,
				relativePath: toRelativePath(homeDirectory, scannedFile.path),
			});
		}
	}

	for (const ruleFile of USER_HOME_SINGLE_FILES) {
		const source = toUserHomeSingleFileSource(ruleFile);
		if (disabledSources.has(source)) {
			continue;
		}

		const filePath = join(homeDirectory, ruleFile);
		const fileInfo = singleFileInfoCached(filePath, cache);
		if (fileInfo === null) {
			continue;
		}

		candidates.push({
			path: fileInfo.path,
			realPath: fileInfo.realPath,
			source,
			distance: GLOBAL_DISTANCE,
			isGlobal: true,
			isSingleFile: true,
			relativePath: toRelativePath(homeDirectory, filePath),
		});
	}

	return candidates;
}

function scanRuleFilesCached(rootDir: string, cache: RuleDiscoveryCache | undefined): ReturnType<typeof scanRuleFiles> {
	if (cache === undefined) {
		return scanRuleFiles({ rootDir });
	}

	const cached = cache.scannedRuleFiles.get(rootDir);
	if (cached !== undefined) {
		return cached;
	}

	const scannedFiles = scanRuleFiles({ rootDir });
	cache.scannedRuleFiles.set(rootDir, scannedFiles);
	return scannedFiles;
}

function singleFileInfoCached(filePath: string, cache: RuleDiscoveryCache | undefined): SingleFileInfo | null {
	if (cache === undefined) {
		return readSingleFileInfo(filePath);
	}

	const cached = cache.singleFileInfo.get(filePath);
	if (cached !== undefined) {
		return cached;
	}

	const fileInfo = readSingleFileInfo(filePath);
	cache.singleFileInfo.set(filePath, fileInfo);
	return fileInfo;
}

function getWalkDirectories(projectRoot: string, targetFile: string | null): WalkDirectory[] {
	if (targetFile === null) {
		return [{ directory: projectRoot, distance: 0 }];
	}

	const startDirectory = dirname(resolve(targetFile));
	if (!isSameOrChildPath(startDirectory, projectRoot)) {
		return [{ directory: projectRoot, distance: 0 }];
	}

	const walkDirectories: WalkDirectory[] = [];
	let currentDirectory = startDirectory;
	let distance = 0;

	while (true) {
		walkDirectories.push({ directory: currentDirectory, distance });
		if (currentDirectory === projectRoot) {
			break;
		}

		const parentDirectory = dirname(currentDirectory);
		if (parentDirectory === currentDirectory) {
			break;
		}

		currentDirectory = parentDirectory;
		distance += 1;
	}

	return walkDirectories;
}

function isSameOrChildPath(childPath: string, parentPath: string): boolean {
	const childRelativePath = relative(parentPath, childPath);
	return childRelativePath === "" || (!childRelativePath.startsWith("..") && !childRelativePath.startsWith("/"));
}

function readSingleFileInfo(filePath: string): SingleFileInfo | null {
	if (!existsSync(filePath)) {
		return null;
	}

	try {
		if (!statSync(filePath).isFile()) {
			return null;
		}

		return { path: filePath, realPath: resolveRealPath(filePath) };
	} catch {
		return null;
	}
}

function resolveRealPath(filePath: string): string {
	try {
		return realpathSync.native(filePath);
	} catch {
		return filePath;
	}
}

function toRelativePath(rootDirectory: string, filePath: string): string {
	return posix.normalize(relative(rootDirectory, filePath).replace(/\\/g, "/"));
}

function toProjectRuleSource(parentDirectory: string, subDirectory: string): RuleSource {
	const source = `${parentDirectory}/${subDirectory}`;
	switch (source) {
		case ".omo/rules":
		case ".claude/rules":
		case ".cursor/rules":
		case ".github/instructions":
			return source;
		default:
			throw new UnsupportedRuleSourceError(`Unsupported project rule source: ${source}`);
	}
}

function toProjectSingleFileSource(ruleFile: string): RuleSource {
	switch (ruleFile) {
		case ".github/copilot-instructions.md":
		case "AGENTS.md":
		case "CLAUDE.md":
		case "CONTEXT.md":
			return ruleFile;
		default:
			throw new UnsupportedRuleSourceError(`Unsupported project single-file source: ${ruleFile}`);
	}
}

function toUserHomeRuleSource(ruleSubdir: string): RuleSource {
	const source = `~/${ruleSubdir}`;
	switch (source) {
		case "~/.omo/rules":
		case "~/.opencode/rules":
		case "~/.claude/rules":
			return source;
		default:
			throw new UnsupportedRuleSourceError(`Unsupported user-home rule source: ${source}`);
	}
}

function toUserHomeSingleFileSource(ruleFile: string): RuleSource {
	const source = `~/${ruleFile}`;
	switch (source) {
		case "~/.config/opencode/AGENTS.md":
		case "~/.claude/CLAUDE.md":
			return source;
		default:
			throw new UnsupportedRuleSourceError(`Unsupported user-home single-file source: ${source}`);
	}
}
