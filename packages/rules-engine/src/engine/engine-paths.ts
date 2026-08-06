import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { PROJECT_SINGLE_FILES } from "./constants.js";
import type { CandidateProjectMembership } from "./engine-types.js";
import type { RuleCandidate } from "./types.js";

const ROOT_SINGLE_FILE_SOURCES = new Set(PROJECT_SINGLE_FILES.filter((source) => !source.includes("/")));

export function isCandidateWithinProjectCached(
	candidate: RuleCandidate,
	projectRoot: string | null,
	projectMembership: CandidateProjectMembership | undefined,
): boolean {
	if (projectMembership === undefined) {
		return isCandidateWithinProject(candidate, projectRoot);
	}

	const cacheKey = `${projectRoot ?? ""}\0${candidate.realPath}`;
	const cached = projectMembership.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const isWithinProject = isCandidateWithinProject(candidate, projectRoot);
	projectMembership.set(cacheKey, isWithinProject);
	return isWithinProject;
}

export function isSameOrChildPath(childPath: string, parentPath: string): boolean {
	const childRelativePath = relative(parentPath, resolve(childPath));
	return childRelativePath === "" || (!childRelativePath.startsWith("..") && !isAbsolute(childRelativePath));
}

export function isRootSingleFile(candidate: RuleCandidate): boolean {
	return candidate.distance === 0 && candidate.isSingleFile && ROOT_SINGLE_FILE_SOURCES.has(candidate.source);
}

export function pathBasesForTarget(
	projectRoot: string | null,
	targetFile: string,
	candidate: RuleCandidate,
): { projectRelative: string; scopeRelative?: string; basename: string } {
	const targetBasename = basename(targetFile);
	if (projectRoot === null) {
		return { projectRelative: targetBasename, basename: targetBasename };
	}

	const projectRelative = toPosixPath(relative(projectRoot, targetFile));
	const scopeDirectory = scopeDirectoryForCandidate(projectRoot, candidate);
	if (scopeDirectory === null) {
		return { projectRelative, basename: targetBasename };
	}

	return {
		projectRelative,
		scopeRelative: toPosixPath(relative(scopeDirectory, targetFile)),
		basename: targetBasename,
	};
}

export function toPosixPath(path: string): string {
	return path.replaceAll("\\", "/");
}

function isCandidateWithinProject(candidate: RuleCandidate, projectRoot: string | null): boolean {
	if (candidate.isGlobal) {
		return true;
	}

	if (projectRoot === null) {
		return false;
	}

	const relativeRealPath = relative(realPathOrResolved(projectRoot), realPathOrResolved(candidate.realPath));
	return relativeRealPath === "" || (!relativeRealPath.startsWith("..") && !isAbsolute(relativeRealPath));
}

function realPathOrResolved(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		return resolve(path);
	}
}

function scopeDirectoryForCandidate(projectRoot: string, candidate: RuleCandidate): string | null {
	if (candidate.isGlobal) {
		return null;
	}

	if (candidate.isSingleFile) {
		return dirname(candidate.path);
	}

	const sourceIndex = candidate.relativePath.indexOf(candidate.source);
	if (sourceIndex === -1) {
		return projectRoot;
	}

	const scopeRelativeDirectory = candidate.relativePath.slice(0, sourceIndex).replace(/\/$/, "");
	return scopeRelativeDirectory.length === 0 ? projectRoot : join(projectRoot, scopeRelativeDirectory);
}
