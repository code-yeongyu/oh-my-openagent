import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
export function sessionIdFrom(input) {
    return typeof input.session_id === "string" && input.session_id.length > 0 ? input.session_id : undefined;
}
export function readLspPostEditCache(sessionId) {
    if (sessionId === undefined)
        return { notConfiguredExtensions: new Set() };
    const state = readSessionState(sessionStatePath(sessionId));
    return { notConfiguredExtensions: new Set(state.notConfiguredExtensions) };
}
export function writeLspPostEditCache(sessionId, cache) {
    if (sessionId === undefined)
        return;
    writeSessionState(sessionStatePath(sessionId), {
        notConfiguredExtensions: [...cache.notConfiguredExtensions].sort(),
    });
}
export function markLspSessionCompacted(sessionId) {
    if (sessionId === undefined)
        return;
    writeSessionState(sessionStatePath(sessionId), emptyState());
}
export function isLspDaemonUnreachableDiagnostics(diagnostics) {
    return diagnostics.includes("LSP daemon unreachable");
}
function sessionStatePath(sessionId) {
    const root = process.env["PLUGIN_DATA"] ?? join(homedir(), ".codex", "codex-lsp");
    return join(root, "sessions", `${safePathSegment(sessionId)}.json`);
}
function readSessionState(path) {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (isRecord(parsed) && isLspSessionState(parsed))
            return normalizeSessionState(parsed);
        return emptyState();
    }
    catch (error) {
        if (error instanceof SyntaxError || (isRecord(error) && error["code"] === "ENOENT"))
            return emptyState();
        throw error;
    }
}
function writeSessionState(path, state) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(state)}\n`);
}
function emptyState() {
    return { notConfiguredExtensions: [] };
}
function safePathSegment(value) {
    return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown-session";
}
function isLspSessionState(value) {
    const notConfiguredExtensions = value["notConfiguredExtensions"] ?? value["unavailableExtensions"];
    return Array.isArray(notConfiguredExtensions) && notConfiguredExtensions.every((item) => typeof item === "string");
}
function normalizeSessionState(value) {
    const notConfiguredExtensions = value["notConfiguredExtensions"] ?? value["unavailableExtensions"];
    return {
        notConfiguredExtensions: Array.isArray(notConfiguredExtensions)
            ? notConfiguredExtensions.filter((item) => typeof item === "string").sort()
            : [],
    };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
