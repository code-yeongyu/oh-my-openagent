import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { PostEditNotConfiguredCache } from "@oh-my-opencode/lsp-core/post-edit";

interface LspSessionState {
	readonly notConfiguredExtensions: readonly string[];
}

export function sessionIdFrom(input: { readonly session_id?: unknown }): string | undefined {
	return typeof input.session_id === "string" && input.session_id.length > 0 ? input.session_id : undefined;
}

export function readLspPostEditCache(sessionId: string | undefined): PostEditNotConfiguredCache {
	if (sessionId === undefined) return { notConfiguredExtensions: new Set() };
	const state = readSessionState(sessionStatePath(sessionId));
	return { notConfiguredExtensions: new Set(state.notConfiguredExtensions) };
}

export function writeLspPostEditCache(sessionId: string | undefined, cache: PostEditNotConfiguredCache): void {
	if (sessionId === undefined) return;
	writeSessionState(sessionStatePath(sessionId), {
		notConfiguredExtensions: [...cache.notConfiguredExtensions].sort(),
	});
}

export function markLspSessionCompacted(sessionId: string | undefined): void {
	if (sessionId === undefined) return;
	writeSessionState(sessionStatePath(sessionId), emptyState());
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
		if (isRecord(parsed) && isLspSessionState(parsed)) return normalizeSessionState(parsed);
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
	return { notConfiguredExtensions: [] };
}

function safePathSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown-session";
}

function isLspSessionState(value: Record<string, unknown>): boolean {
	const notConfiguredExtensions = value["notConfiguredExtensions"] ?? value["unavailableExtensions"];
	return Array.isArray(notConfiguredExtensions) && notConfiguredExtensions.every((item) => typeof item === "string");
}

function normalizeSessionState(value: Record<string, unknown>): LspSessionState {
	const notConfiguredExtensions = value["notConfiguredExtensions"] ?? value["unavailableExtensions"];
	return {
		notConfiguredExtensions: Array.isArray(notConfiguredExtensions)
			? notConfiguredExtensions.filter((item) => typeof item === "string").sort()
			: [],
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
