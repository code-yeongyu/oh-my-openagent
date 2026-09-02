import { UlwLoopError } from "./types.js";
const PLACEHOLDER_PATTERN = /^(?:<replace:[^>]+>|placeholder|todo|tbd|n\/a|stub)$/i;
export function invalid(message, field) {
    throw new UlwLoopError(message, "ULW_LOOP_QUALITY_GATE_INVALID", { details: { field } });
}
export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function section(value, field) {
    return isRecord(value) ? value : invalid(`Final quality gate is missing ${field} evidence.`, field);
}
export function textField(value, field) {
    if (typeof value !== "string" || value.trim() === "")
        invalid(`Final quality gate requires non-empty ${field}.`, field);
    const trimmed = value.trim();
    if (PLACEHOLDER_PATTERN.test(trimmed))
        invalid(`Final quality gate rejects placeholder ${field}.`, field);
    return trimmed;
}
export function numberField(value, field) {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : invalid(`Final quality gate requires numeric ${field}.`, field);
}
export function stringArray(value, field) {
    if (!Array.isArray(value) || value.length === 0)
        return invalid(`Final quality gate requires ${field}.`, field);
    return value.map((item) => textField(item, field));
}
export function emptyBlockers(value, field) {
    if (Array.isArray(value) && value.length === 0)
        return [];
    invalid(`${field} must be empty.`, field);
}
export function literal(value, expected, field) {
    if (value === expected)
        return expected;
    invalid(`${field} must be ${String(expected)}.`, field);
}
