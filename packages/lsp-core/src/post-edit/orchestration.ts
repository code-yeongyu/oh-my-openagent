import { extname } from "node:path";

import type { PostEditFileLocation } from "./file-location.js";
import { notInstalledGuidance, type PostEditNotInstalledOutcome } from "./not-installed-guidance.js";

const DEFAULT_MAX_CONCURRENCY = 4;
const CLEAN_DIAGNOSTICS_TEXT = "No diagnostics found";

export type PostEditDiagnosticsOutcome =
	| string
	| {
			readonly kind: "not_configured";
			readonly extension: string;
	  }
	| PostEditNotInstalledOutcome;

export type DiagnosticsRunner = (filePath: string) => Promise<PostEditDiagnosticsOutcome>;

export interface PostEditDiagnosticsBlock {
	readonly filePath: string;
	readonly diagnostics: string;
	/** False for missing-server guidance: it is feedback for the model, not a defect in the edit. */
	readonly blocking: boolean;
}

export interface PostEditDiagnosticsObservation {
	readonly filePath: string;
	readonly kind: "block" | "clean" | "not_configured" | "not_installed";
}

export interface PostEditDiagnosticsResult {
	readonly blocks: readonly PostEditDiagnosticsBlock[];
	readonly observations: readonly PostEditDiagnosticsObservation[];
}

export interface PostEditNotConfiguredCache {
	readonly notConfiguredExtensions: Set<string>;
	readonly notInstalledServers: Set<string>;
}

export interface CollectPostEditDiagnosticsInput {
	readonly filePaths: readonly string[];
	readonly runDiagnostics: DiagnosticsRunner;
	readonly cache?: PostEditNotConfiguredCache;
	readonly maxConcurrency?: number;
	readonly locateFile?: (filePath: string) => PostEditFileLocation;
}

interface IndexedFilePath {
	readonly index: number;
	readonly filePath: string;
}

interface IndexedDiagnostics {
	readonly index: number;
	readonly filePath: string;
	readonly outcome: PostEditDiagnosticsOutcome;
}

export function createPostEditNotConfiguredCache(): PostEditNotConfiguredCache {
	return { notConfiguredExtensions: new Set(), notInstalledServers: new Set() };
}

export function resetPostEditNotConfiguredCache(cache: PostEditNotConfiguredCache): void {
	cache.notConfiguredExtensions.clear();
	cache.notInstalledServers.clear();
}

export async function collectPostEditDiagnostics(
	input: CollectPostEditDiagnosticsInput,
): Promise<PostEditDiagnosticsResult> {
	const cache = input.cache === undefined ? createPostEditNotConfiguredCache() : input.cache;
	const filePaths = firstSeenDiagnosticTargets(input.filePaths, cache);
	const results = await runBoundedDiagnostics(filePaths, input.runDiagnostics, input.maxConcurrency);
	const blocks: PostEditDiagnosticsBlock[] = [];
	const observations: PostEditDiagnosticsObservation[] = [];

	for (const result of results) {
		const outcome = result.outcome;
		const classification =
			typeof outcome !== "string" && outcome.kind === "not_installed"
				? classifyNotInstalled(notInstalledGuidance(result.filePath, outcome, cache, input.locateFile))
				: classifyDiagnostics(outcome);
		switch (classification.kind) {
			case "not_installed":
				observations.push({ filePath: result.filePath, kind: "not_installed" });
				break;
			case "clean":
				observations.push({ filePath: result.filePath, kind: "clean" });
				break;
			case "not_configured":
				cache.notConfiguredExtensions.add(classification.extension);
				observations.push({ filePath: result.filePath, kind: "not_configured" });
				break;
			case "block":
				blocks.push({ filePath: result.filePath, diagnostics: classification.diagnostics, blocking: true });
				observations.push({ filePath: result.filePath, kind: "block" });
				break;
			case "guidance":
				blocks.push({ filePath: result.filePath, diagnostics: classification.text, blocking: false });
				observations.push({ filePath: result.filePath, kind: "block" });
				break;
			default: {
				const exhaustive: never = classification;
				return exhaustive;
			}
		}
	}

	return { blocks, observations };
}

function firstSeenDiagnosticTargets(
	filePaths: readonly string[],
	cache: PostEditNotConfiguredCache,
): readonly IndexedFilePath[] {
	const seen = new Set<string>();
	const targets: IndexedFilePath[] = [];
	for (const filePath of filePaths) {
		if (filePath.length === 0 || seen.has(filePath)) continue;
		seen.add(filePath);
		const extension = extensionKey(filePath);
		if (extension !== undefined && cache.notConfiguredExtensions.has(extension)) continue;
		targets.push({ index: targets.length, filePath });
	}
	return targets;
}

async function runBoundedDiagnostics(
	filePaths: readonly IndexedFilePath[],
	runDiagnostics: DiagnosticsRunner,
	maxConcurrency: number | undefined,
): Promise<readonly IndexedDiagnostics[]> {
	const results: IndexedDiagnostics[] = [];
	const workerCount = Math.min(Math.max(1, maxConcurrency ?? DEFAULT_MAX_CONCURRENCY), filePaths.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		for (;;) {
			const target = filePaths[nextIndex];
			nextIndex += 1;
			if (target === undefined) return;
			results[target.index] = {
				index: target.index,
				filePath: target.filePath,
				outcome: await collectFileDiagnostics(target.filePath, runDiagnostics),
			};
		}
	}

	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return results.filter((result) => result !== undefined);
}

async function collectFileDiagnostics(
	filePath: string,
	runDiagnostics: DiagnosticsRunner,
): Promise<PostEditDiagnosticsOutcome> {
	try {
		return normalizeDiagnosticsOutcome(await runDiagnostics(filePath));
	} catch (error) {
		if (error instanceof Error) return formatDiagnosticsError(error);
		return normalizeDiagnosticsText(String(error));
	}
}

function normalizeDiagnosticsOutcome(outcome: PostEditDiagnosticsOutcome): PostEditDiagnosticsOutcome {
	if (typeof outcome === "string") return normalizeDiagnosticsText(outcome);
	if (outcome.kind === "not_installed") return { ...outcome, text: normalizeDiagnosticsText(outcome.text) };
	return outcome;
}

function classifyNotInstalled(
	guidance: string | undefined,
): { readonly kind: "not_installed" } | { readonly kind: "guidance"; readonly text: string } {
	return guidance === undefined ? { kind: "not_installed" } : { kind: "guidance", text: guidance };
}

function normalizeDiagnosticsText(text: string): string {
	return text.trim();
}

function formatDiagnosticsError(error: Error): string {
	const message = normalizeDiagnosticsText(error.message);
	return message.length > 0 ? message : normalizeDiagnosticsText(String(error));
}

function classifyDiagnostics(
	outcome: Exclude<PostEditDiagnosticsOutcome, PostEditNotInstalledOutcome>,
):
	| { readonly kind: "clean" }
	| { readonly kind: "not_configured"; readonly extension: string }
	| { readonly kind: "block"; readonly diagnostics: string } {
	if (typeof outcome !== "string") {
		return { kind: "not_configured", extension: outcome.extension };
	}
	const diagnostics = outcome;
	if (diagnostics.length === 0 || diagnostics === CLEAN_DIAGNOSTICS_TEXT) return { kind: "clean" };
	return { kind: "block", diagnostics };
}

function extensionKey(filePath: string): string | undefined {
	const extension = extname(filePath).toLowerCase();
	return extension.length === 0 ? undefined : extension;
}
