import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";

interface LspSessionState {
	readonly unavailableExtensions: readonly string[];
	readonly postCompactProbePending?: boolean;
}

export interface DiagnosticsObservation {
	readonly filePath: string;
	readonly unavailable: boolean;
}

export function sessionIdFrom(input: { readonly session_id?: unknown }): string | undefined {
	return typeof input.session_id === "string" && input.session_id.length > 0 ? input.session_id : undefined;
}

export function shouldSkipUnavailableLspDiagnostics(filePath: string, sessionId: string | undefined): boolean {
	if (sessionId === undefined) return false;
	const state = readSessionState(sessionStatePath(sessionId));
	const extension = extensionKey(filePath);
	return (
		extension !== undefined &&
		state.postCompactProbePending !== true &&
		state.unavailableExtensions.includes(extension)
	);
}

export function recordLspDiagnosticsObservations(
	sessionId: string | undefined,
	observations: readonly DiagnosticsObservation[],
): void {
	if (sessionId === undefined || observations.length === 0) return;
	const state = readSessionState(sessionStatePath(sessionId));
	const unavailableExtensions = new Set(state.unavailableExtensions);

	for (const observation of observations) {
		const extension = extensionKey(observation.filePath);
		if (extension === undefined) continue;
		if (observation.unavailable) {
			unavailableExtensions.add(extension);
		} else {
			unavailableExtensions.delete(extension);
		}
	}

	writeSessionState(sessionStatePath(sessionId), { unavailableExtensions: [...unavailableExtensions].sort() });
}

export function markLspSessionCompacted(sessionId: string | undefined): void {
	if (sessionId === undefined) return;
	const state = readSessionState(sessionStatePath(sessionId));
	if (state.unavailableExtensions.length === 0) return;
	writeSessionState(sessionStatePath(sessionId), {
		unavailableExtensions: state.unavailableExtensions,
		postCompactProbePending: true,
	});
}

export function isUnavailableLspDiagnostics(diagnostics: string): boolean {
	const normalized = diagnostics.trim();
	return (
		normalized.includes("LSP request timeout (method: initialize)") ||
		normalized.includes("LSP server is still initializing") ||
		normalized.includes("NOT INSTALLED") ||
		normalized.includes("Command not found:")
	);
}

export function isLspDaemonUnreachableDiagnostics(diagnostics: string): boolean {
	return diagnostics.includes("LSP daemon unreachable");
}

function sessionStatePath(sessionId: string): string {
	const root = process.env["PLUGIN_DATA"] ?? join(homedir(), ".codex", "codex-lsp");
	return join(root, "sessions", `${safePathSegment(sessionId)}.json`);
}

function readSessionState(path: string): LspSessionState {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (isLspSessionState(parsed)) return parsed;
		return emptyState();
	} catch (error) {
		if (error instanceof SyntaxError || (isRecord(error) && error["code"] === "ENOENT")) return emptyState();
		throw error;
	}
}

function writeSessionState(path: string, state: LspSessionState): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state)}\n`);
}

function emptyState(): LspSessionState {
	return { unavailableExtensions: [] };
}

function extensionKey(filePath: string): string | undefined {
	const extension = extname(filePath).toLowerCase();
	return extension.length === 0 ? undefined : extension;
}

function safePathSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown-session";
}

function isLspSessionState(value: unknown): value is LspSessionState {
	if (!isRecord(value) || !Array.isArray(value["unavailableExtensions"])) return false;
	const postCompactProbePending = value["postCompactProbePending"];
	return (
		value["unavailableExtensions"].every((item) => typeof item === "string") &&
		(postCompactProbePending === undefined || typeof postCompactProbePending === "boolean")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
