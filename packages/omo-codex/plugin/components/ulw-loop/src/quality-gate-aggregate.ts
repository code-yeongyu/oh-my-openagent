import { resolve } from "node:path";
import type { ValidateQualityGateOptions } from "./quality-gate.js";
import { isRecord } from "./quality-gate-fields.js";
import { UlwLoopError } from "./types.js";

type Defect = { readonly field: string; readonly message: string };
const PLACEHOLDER = /^(?:<replace:[^>]+>|placeholder|todo|tbd|n\/a|stub)$/i;

function add(defects: Defect[], field: string, message: string): void {
	defects.push({ field, message });
}
function text(value: unknown, field: string, defects: Defect[]): void {
	if (typeof value !== "string" || value.trim() === "")
		add(defects, field, `Final quality gate requires non-empty ${field}.`);
	else if (PLACEHOLDER.test(value.trim())) add(defects, field, `Final quality gate rejects placeholder ${field}.`);
}
function section(value: unknown, field: string, defects: Defect[]): Record<string, unknown> {
	if (!isRecord(value)) {
		add(defects, field, `Final quality gate is missing ${field} evidence.`);
		return {};
	}
	return value;
}

export function aggregateQualityGateDefects(input: unknown, opts: ValidateQualityGateOptions | undefined): void {
	if (!isRecord(input)) return;
	const defects: Defect[] = [];
	const gate = input;
	const manual = section(gate["manualQa"], "manualQa", defects);
	const review = section(gate["gateReview"], "gateReview", defects);
	text(manual["evidence"], "manualQa.evidence", defects);
	text(review["evidence"], "gateReview.evidence", defects);
	if (review["recommendation"] !== "APPROVE")
		add(defects, "gateReview.recommendation", "gateReview.recommendation must be APPROVE.");
	const artifacts = Array.isArray(manual["artifactRefs"]) ? manual["artifactRefs"] : [];
	for (const [index, item] of artifacts.entries()) {
		if (!isRecord(item)) continue;
		const path = item["path"];
		if (typeof path !== "string" || path.trim() === "") continue;
		if (opts?.repoRoot !== undefined && opts.fs !== undefined && !opts.fs.existsSync(resolve(opts.repoRoot, path)))
			add(
				defects,
				`manualQa.artifactRefs[${index}].path`,
				`manualQa.artifactRefs[${index}].path must point to an existing artifact.`,
			);
	}
	if (defects.length === 0) return;
	const truncated = defects.length > 25;
	const fields = defects.slice(0, 25).map(({ field, message }) => ({ field, message }));
	const message = [
		`Final quality gate has ${fields.length}${truncated ? "+" : ""} validation defects:`,
		...fields.map((item) => `- ${item.field}: ${item.message}`),
	].join("\n");
	throw new UlwLoopError(message, "ULW_LOOP_QUALITY_GATE_INVALID", {
		details: { field: fields[0]?.field, fields, ...(truncated ? { truncated: true } : {}) },
	});
}
