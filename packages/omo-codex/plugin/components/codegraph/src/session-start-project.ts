import { realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export type CodegraphProjectState =
	| { readonly kind: "inconclusive"; readonly reason: string }
	| { readonly kind: "initialized" }
	| { readonly ancestorRoot: string; readonly kind: "nested-root" }
	| { readonly kind: "uninitialized" };

export type CodegraphAncestorState = Exclude<CodegraphProjectState, { readonly kind: "initialized" }>;
export type CodegraphExactProjectState = Extract<
	CodegraphProjectState,
	{ readonly kind: "inconclusive" | "initialized" | "uninitialized" }
>;

type DatabaseState =
	| { readonly kind: "inconclusive"; readonly reason: string }
	| { readonly kind: "missing" }
	| { readonly kind: "present" };

export interface CodegraphProjectProbeOptions {
	readonly probeDatabase?: (directory: string) => DatabaseState;
}

export function probeCodegraphProject(
	projectRoot: string,
	options: CodegraphProjectProbeOptions = {},
): CodegraphProjectState {
	const resolved = resolveProjectRoot(projectRoot);
	if (resolved.kind === "inconclusive") return resolved;

	const probeDatabase = options.probeDatabase ?? probeDatabaseAt;
	const exact = probeResolvedExactProject(resolved.projectRoot, probeDatabase);
	if (exact.kind !== "uninitialized") return exact;
	return probeResolvedAncestors(resolved.projectRoot, probeDatabase);
}

export function probeExactCodegraphProject(
	projectRoot: string,
	options: CodegraphProjectProbeOptions = {},
): CodegraphExactProjectState {
	const resolved = resolveProjectRoot(projectRoot);
	if (resolved.kind === "inconclusive") return resolved;
	return probeResolvedExactProject(resolved.projectRoot, options.probeDatabase ?? probeDatabaseAt);
}

export function probeCodegraphAncestors(
	projectRoot: string,
	options: CodegraphProjectProbeOptions = {},
): CodegraphAncestorState {
	const resolved = resolveProjectRoot(projectRoot);
	if (resolved.kind === "inconclusive") return resolved;
	return probeResolvedAncestors(resolved.projectRoot, options.probeDatabase ?? probeDatabaseAt);
}

function probeResolvedExactProject(
	projectRoot: string,
	probeDatabase: (directory: string) => DatabaseState,
): CodegraphExactProjectState {
	const exact = probeDatabase(projectRoot);
	if (exact.kind === "present") return { kind: "initialized" };
	if (exact.kind === "inconclusive") return exact;
	return { kind: "uninitialized" };
}

function probeResolvedAncestors(
	projectRoot: string,
	probeDatabase: (directory: string) => DatabaseState,
): CodegraphAncestorState {
	let ancestorRoot = dirname(projectRoot);
	while (ancestorRoot !== projectRoot) {
		const database = probeDatabase(ancestorRoot);
		if (database.kind === "present") return { ancestorRoot, kind: "nested-root" };
		if (database.kind === "inconclusive") return database;
		const parent = dirname(ancestorRoot);
		if (parent === ancestorRoot) break;
		ancestorRoot = parent;
	}
	return { kind: "uninitialized" };
}

function resolveProjectRoot(projectRoot: string):
	| { readonly kind: "inconclusive"; readonly reason: string }
	| { readonly kind: "resolved"; readonly projectRoot: string } {
	try {
		return { kind: "resolved", projectRoot: realpathSync(projectRoot) };
	} catch (error) {
		if (error instanceof Error) return { kind: "inconclusive", reason: error.message };
		throw error;
	}
}

function probeDatabaseAt(directory: string): DatabaseState {
	try {
		statSync(join(directory, ".codegraph", "codegraph.db"));
		return { kind: "present" };
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		const code = errorCode(error);
		if (code === "ENOENT" || code === "ENOTDIR") return { kind: "missing" };
		return { kind: "inconclusive", reason: error.message };
	}
}

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const code = Reflect.get(error, "code");
	return typeof code === "string" ? code : undefined;
}
