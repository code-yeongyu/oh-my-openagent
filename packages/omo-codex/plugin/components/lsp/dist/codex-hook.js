import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { callDiagnosticsViaDaemon } from "@code-yeongyu/lsp-daemon/client";
import { collectPostEditDiagnostics } from "@oh-my-opencode/lsp-core/post-edit";
import { parseLspRequestContext } from "@oh-my-opencode/lsp-core/request-context";
import { ensureLspDaemonCliEnv } from "./daemon-cli-path.js";
import { isLspDaemonUnreachableDiagnostics, markLspSessionCompacted, readLspPostEditCache, sessionIdFrom, writeLspPostEditCache, } from "./lsp-session-state.js";
import { extractMutatedFilePaths } from "./mutated-file-paths.js";
export { extractMutatedFilePaths } from "./mutated-file-paths.js";
const DIAGNOSTIC_START_PATTERN = /(?:error|warning|information|hint)\[[^\]\r\n]+\] \(\d+\) at \d+:\d+:/g;
const DIAGNOSTIC_CHUNK_PATTERN = /^(?:error|warning|information|hint)\[[^\]\r\n]+\] \(\d+\) at \d+:\d+:/;
const DEFAULT_MAX_HOOK_FEEDBACK_CHARS = 8000;
const CONTEXT_PRESSURE_MAX_HOOK_FEEDBACK_CHARS = 1200;
const CONTEXT_PRESSURE_MARKERS = [
    "context compacted",
    "context_length_exceeded",
    "skill descriptions were shortened",
    "context_too_large",
    "codex ran out of room in the model's context window",
    "your input exceeds the context window",
    "long threads and multiple compactions",
];
export async function runLspDiagnosticsText(filePath) {
    ensureLspDaemonCliEnv();
    const result = await callDiagnosticsViaDaemon(filePath, { context: codexLspRequestContext() });
    return postEditOutcomeFromDaemonResult(result);
}
function postEditOutcomeFromDaemonResult(result) {
    const availability = notConfiguredAvailability(result.details);
    if (availability !== undefined)
        return { kind: "not_configured", extension: availability.extension };
    return result.content.map((block) => block.text).join("\n");
}
function notConfiguredAvailability(details) {
    if (!isRecord(details))
        return undefined;
    const availability = details["availability"];
    if (!isRecord(availability))
        return undefined;
    if (availability["kind"] !== "not_configured")
        return undefined;
    const extension = availability["extension"];
    return typeof extension === "string" && extension.length > 0 ? { extension } : undefined;
}
export function codexLspRequestContext(env = process.env, cwd = process.cwd()) {
    const canonicalCwd = realpathSync(resolve(cwd));
    const codexHome = resolve(env["CODEX_HOME"]?.trim() || join(homedir(), ".codex"));
    return parseLspRequestContext({
        cwd: canonicalCwd,
        projectConfigPaths: [join(canonicalCwd, ".codex", "lsp-client.json")],
        userConfigPath: join(codexHome, "lsp-client.json"),
        installDecisionsPath: join(codexHome, "lsp-install-decisions.json"),
        capabilities: { installDecisionTool: true },
    });
}
export async function runLspPostToolUseHook(input, runDiagnostics = runLspDiagnosticsText) {
    const sessionId = sessionIdFrom(input);
    const filePaths = extractMutatedFilePaths(input);
    if (filePaths.length === 0)
        return "";
    const cache = readLspPostEditCache(sessionId);
    const result = await collectPostEditDiagnostics({ filePaths, runDiagnostics, cache });
    writeLspPostEditCache(sessionId, cache);
    const blocks = result.blocks.filter(({ diagnostics }) => !isLspDaemonUnreachableDiagnostics(diagnostics));
    if (blocks.length === 0)
        return "";
    const rawReason = blocks.map(formatDiagnosticBlock).join("\n\n");
    const reason = limitHookText(rawReason, hookFeedbackLimit(input.transcript_path));
    const output = {
        decision: "block",
        reason,
        hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: reason,
        },
    };
    return `${JSON.stringify(output)}\n`;
}
export async function runLspPostCompactHook(input) {
    markLspSessionCompacted(sessionIdFrom(input));
    return "";
}
function formatDiagnosticBlock({ filePath, diagnostics }) {
    return `LSP diagnostics after editing ${filePath}:\n\n${formatDiagnosticsForDisplay(diagnostics)}`;
}
function formatDiagnosticsForDisplay(diagnostics) {
    const chunks = splitDiagnosticChunks(diagnostics);
    if (!chunks.some(isDiagnosticChunk))
        return chunks.join("\n").trim();
    return chunks.map(formatDiagnosticChunk).join("\n");
}
function splitDiagnosticChunks(diagnostics) {
    const normalized = diagnostics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (normalized.length === 0)
        return [];
    const matches = Array.from(normalized.matchAll(DIAGNOSTIC_START_PATTERN));
    const firstMatch = matches[0];
    if (firstMatch?.index === undefined)
        return [normalized];
    const chunks = [];
    const leadingText = normalized.slice(0, firstMatch.index).trim();
    if (leadingText.length > 0)
        chunks.push(leadingText);
    for (const [index, match] of matches.entries()) {
        if (match.index === undefined)
            continue;
        const nextMatch = matches[index + 1];
        const end = nextMatch?.index ?? normalized.length;
        const chunk = normalized.slice(match.index, end).trim();
        if (chunk.length > 0)
            chunks.push(chunk);
    }
    return chunks;
}
function formatDiagnosticChunk(chunk) {
    const lines = chunk.split("\n");
    const firstLine = lines[0];
    if (firstLine === undefined)
        return "";
    if (!isDiagnosticChunk(firstLine))
        return chunk;
    const followingLines = lines.slice(1).map((line) => `  ${line}`);
    return [`- ${firstLine}`, ...followingLines].join("\n");
}
function isDiagnosticChunk(chunk) {
    return DIAGNOSTIC_CHUNK_PATTERN.test(chunk);
}
function hookFeedbackLimit(transcriptPath) {
    return isContextPressureTranscript(transcriptPath)
        ? CONTEXT_PRESSURE_MAX_HOOK_FEEDBACK_CHARS
        : DEFAULT_MAX_HOOK_FEEDBACK_CHARS;
}
function isContextPressureTranscript(transcriptPath) {
    if (typeof transcriptPath !== "string")
        return false;
    try {
        return hasContextPressureMarker(readFileSync(transcriptPath, "utf8"));
    }
    catch (error) {
        if (error instanceof Error)
            return false;
        throw error;
    }
}
function hasContextPressureMarker(text) {
    const normalizedText = text.toLowerCase();
    return CONTEXT_PRESSURE_MARKERS.some((marker) => normalizedText.includes(marker));
}
function limitHookText(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    const marker = `\n\n[Truncated hook output to ${maxChars} chars to avoid Codex context overflow.]`;
    if (marker.length >= maxChars)
        return marker.slice(0, maxChars);
    const head = text.slice(0, maxChars - marker.length).replace(/[ \t\r\n]+$/, "");
    return `${head}${marker}`;
}
export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
