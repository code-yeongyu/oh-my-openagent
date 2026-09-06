import { UlwLoopError } from "./types.js";

const PLACEHOLDER_PATTERN = /^(?:<replace:[^>]+>|placeholder|todo|tbd|n\/a|stub)$/i;
type QualityGateDefect = { readonly field: string; readonly message: string };
type QualityGateCollector = {
	readonly defects: QualityGateDefect[];
	readonly poisonedFields: Set<string>;
	readonly poisonedArtifactKinds: Set<string>;
};
let activeCollector: QualityGateCollector | undefined;

/** A recorded defect poisons only its field; consumers skip dependent checks while preserving valid siblings and entry identity. */
export function withQualityGateCollector<T>(operation: () => T): T {
	const previous = activeCollector;
	const collector: QualityGateCollector = { defects: [], poisonedFields: new Set(), poisonedArtifactKinds: new Set() };
	activeCollector = collector;
	try {
		const result = operation();
		if (collector.defects.length === 0) return result;
		throwQualityGateDefects(collector.defects);
	} finally {
		activeCollector = previous;
	}
}

export function throwQualityGateDefects(defects: readonly QualityGateDefect[]): never {
	const uniqueDefects = [
		...new Map(defects.map((defect) => [`${defect.field}\u0000${defect.message}`, defect])).values(),
	];
	const fields = uniqueDefects.slice(0, 25);
	const truncated = uniqueDefects.length > fields.length;
	const message = [
		`Final quality gate has ${fields.length}${truncated ? "+" : ""} validation defects:`,
		...fields.map((item) => `- ${item.field}: ${item.message}`),
	].join("\n");
	throw new UlwLoopError(message, "ULW_LOOP_QUALITY_GATE_INVALID", {
		details: { field: fields[0]?.field, fields, ...(truncated ? { truncated: true } : {}) },
	});
}
export function invalid(message: string, field: string): undefined {
	if (activeCollector === undefined)
		throw new UlwLoopError(message, "ULW_LOOP_QUALITY_GATE_INVALID", { details: { field } });
	activeCollector.defects.push({ field, message });
	activeCollector.poisonedFields.add(field);
	return undefined;
}
export function isPoisoned(field: string): boolean {
	return activeCollector?.poisonedFields.has(field) ?? false;
}
export function poisonField(field: string): void {
	activeCollector?.poisonedFields.add(field);
}
export function markPoisonedArtifactKind(id: string): void {
	activeCollector?.poisonedArtifactKinds.add(id);
}
export function isPoisonedArtifactKind(id: string): boolean {
	return activeCollector?.poisonedArtifactKinds.has(id) ?? false;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function section(value: unknown, field: string): Record<string, unknown> {
	if (isRecord(value)) return value;
	invalid(`Final quality gate is missing ${field} evidence.`, field);
	return {};
}
export function textField(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		invalid(`Final quality gate requires non-empty ${field}.`, field);
		return "";
	}
	const trimmed = value.trim();
	if (PLACEHOLDER_PATTERN.test(trimmed)) invalid(`Final quality gate rejects placeholder ${field}.`, field);
	return trimmed;
}
export function numberField(value: unknown, field: string): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	invalid(`Final quality gate requires numeric ${field}.`, field);
	return 0;
}
export function stringArray(value: unknown, field: string): readonly string[] {
	if (!Array.isArray(value) || value.length === 0) {
		invalid(`Final quality gate requires ${field}.`, field);
		return [];
	}
	return value.map((item) => textField(item, field));
}
export function emptyBlockers(value: unknown, field: string): readonly [] {
	if (Array.isArray(value) && value.length === 0) return [];
	invalid(`${field} must be empty.`, field);
	return [];
}
export function literal<T extends string | boolean>(value: unknown, expected: T, field: string): T {
	if (value === expected) return expected;
	invalid(`${field} must be ${String(expected)}.`, field);
	return expected;
}
