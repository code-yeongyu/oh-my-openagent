import {
	pruneDeadCodegraphProjectStores,
	type PruneCodegraphStoreResult,
} from "../../../../../utils/src/codegraph/workspace.ts";

interface PruneCodegraphProjectStoresBestEffortOptions {
	readonly debugLog?: (message: string) => void;
	readonly prune?: (options: { readonly homeDir: string }) => PruneCodegraphStoreResult;
}

const NON_FATAL_GC_ERROR_CODES = new Set(["EACCES", "EBUSY", "ENOENT", "ENOTEMPTY", "ENOTDIR", "EPERM"]);

export function pruneCodegraphProjectStoresBestEffort(
	homeDir: string,
	options: PruneCodegraphProjectStoresBestEffortOptions = {},
): void {
	try {
		(options.prune ?? pruneDeadCodegraphProjectStores)({ homeDir });
	} catch (error) {
		if (!isNonFatalCodegraphGcError(error)) throw error;
		options.debugLog?.(`CodeGraph cache GC skipped: ${error.message}`);
	}
}

export function isNonFatalCodegraphGcError(error: unknown): error is Error {
	if (!(error instanceof Error)) return false;
	const code = typeof error === "object" && error !== null && "code" in error ? (error as { readonly code?: unknown }).code : undefined;
	return typeof code === "string" && NON_FATAL_GC_ERROR_CODES.has(code);
}
