import { readFileSync } from "node:fs";
import { buildUltraworkAdditionalContext } from "./ultrawork-skill-pointer.js";
const ULTRAWORK_CURRENT_PROMPT_PATTERN = /(?:ultrawork|ulw)/i;
const ULTRAWORK_DIRECTIVE_MARKER = "<ultrawork-mode>";
const TRANSCRIPT_SEARCH_BYTES = 512_000;
const CONTEXT_PRESSURE_MARKERS = [
    "context compacted",
    "context_length_exceeded",
    "skill descriptions were shortened",
    "context_too_large",
    "codex ran out of room in the model's context window",
    "your input exceeds the context window",
    "long threads and multiple compactions",
];
export function buildUltraworkDirectiveOutput(input, options = {}) {
    if (isContextPressureRecoveryPrompt(input.prompt))
        return "";
    if (hasUltraworkDirectiveAlreadyInTranscript(input.transcript_path))
        return "";
    if (isContextPressureTranscript(input.transcript_path))
        return "";
    return isUltraworkPrompt(input.prompt)
        ? formatAdditionalContextOutput(buildUltraworkAdditionalContext(options))
        : "";
}
function hasUltraworkDirectiveAlreadyInTranscript(transcriptPath) {
    if (transcriptPath === undefined || transcriptPath === null)
        return false;
    try {
        const rawTranscript = readTranscriptTail(transcriptPath);
        for (const line of rawTranscript.split(/\r?\n/)) {
            const parsed = parseJsonLine(line);
            if (!isRecord(parsed))
                continue;
            const hookSpecificOutput = parsed["hookSpecificOutput"];
            if (!isRecord(hookSpecificOutput))
                continue;
            if (hookSpecificOutput["hookEventName"] !== "UserPromptSubmit")
                continue;
            if (typeof hookSpecificOutput["additionalContext"] === "string" &&
                hookSpecificOutput["additionalContext"].includes(ULTRAWORK_DIRECTIVE_MARKER)) {
                return true;
            }
        }
    }
    catch (error) {
        if (error instanceof Error)
            return false;
        throw error;
    }
    return false;
}
function readTranscriptTail(transcriptPath) {
    const rawTranscript = readFileSync(transcriptPath);
    return rawTranscript.subarray(Math.max(0, rawTranscript.byteLength - TRANSCRIPT_SEARCH_BYTES)).toString("utf8");
}
function isUltraworkPrompt(prompt) {
    return ULTRAWORK_CURRENT_PROMPT_PATTERN.test(prompt);
}
function isContextPressureRecoveryPrompt(prompt) {
    const normalizedPrompt = prompt.toLowerCase();
    return CONTEXT_PRESSURE_MARKERS.some((marker) => normalizedPrompt.includes(marker));
}
function isContextPressureTranscript(transcriptPath) {
    if (transcriptPath === undefined || transcriptPath === null)
        return false;
    try {
        return isContextPressureRecoveryPrompt(readTranscriptTail(transcriptPath));
    }
    catch (error) {
        if (error instanceof Error)
            return false;
        throw error;
    }
}
function formatAdditionalContextOutput(additionalContext) {
    const normalizedContext = normalizeAdditionalContext(additionalContext);
    if (normalizedContext.length === 0)
        return "";
    const output = {
        hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: normalizedContext,
        },
    };
    return `${JSON.stringify(output)}\n`;
}
function normalizeAdditionalContext(additionalContext) {
    return additionalContext.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}
function parseJsonLine(line) {
    if (line.trim().length === 0)
        return null;
    try {
        const parsed = JSON.parse(line);
        return parsed;
    }
    catch (error) {
        if (error instanceof Error)
            return null;
        throw error;
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
