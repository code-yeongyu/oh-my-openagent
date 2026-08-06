import { existsSync, realpathSync, statSync } from "node:fs";

import { scanRuleFiles } from "./scanner.js";

type ScannedRuleFiles = ReturnType<typeof scanRuleFiles>;

interface SingleFileInfo {
	readonly path: string;
	readonly realPath: string;
}

export interface RuleDiscoveryCache {
	readonly scannedRuleFiles: Map<string, ScannedRuleFiles>;
	readonly singleFileInfo: Map<string, SingleFileInfo | null>;
}

export function createRuleDiscoveryCache(): RuleDiscoveryCache {
	return { scannedRuleFiles: new Map(), singleFileInfo: new Map() };
}

export function scanRuleFilesCached(rootDir: string, cache: RuleDiscoveryCache | undefined): ScannedRuleFiles {
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

export function singleFileInfoCached(filePath: string, cache: RuleDiscoveryCache | undefined): SingleFileInfo | null {
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
