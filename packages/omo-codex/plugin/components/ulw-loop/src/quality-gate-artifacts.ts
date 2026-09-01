import { resolve } from "node:path";
import { isWithinAttemptDir } from "./paths.js";
import type { ValidateQualityGateOptions } from "./quality-gate.js";
import { invalid, section, stringArray, textField } from "./quality-gate-fields.js";
import type { UlwLoopManualQaArtifactKind, UlwLoopManualQaArtifactRef, UlwLoopManualQaSurface } from "./types.js";

export function surfaceField(value: unknown, field: string): UlwLoopManualQaSurface {
	if (
		value === "cli" ||
		value === "http" ||
		value === "tmux" ||
		value === "browser" ||
		value === "gui" ||
		value === "data"
	)
		return value;
	invalid(`${field} must be a supported manual QA surface.`, field);
}

export function kindField(value: unknown, field: string): UlwLoopManualQaArtifactKind {
	if (
		value === "cli-transcript" ||
		value === "log" ||
		value === "screenshot" ||
		value === "image" ||
		value === "http-dump" ||
		value === "data-diff"
	)
		return value;
	invalid(`${field} must be a supported artifact kind.`, field);
}

export function artifactCompatible(surface: UlwLoopManualQaSurface, kind: UlwLoopManualQaArtifactKind): boolean {
	switch (surface) {
		case "cli":
		case "tmux":
			return kind === "cli-transcript" || kind === "log";
		case "http":
			return kind === "http-dump";
		case "browser":
		case "gui":
			return kind === "screenshot" || kind === "image";
		case "data":
			return kind === "data-diff";
		default:
			invalid("manualQa.surfaceEvidence has an unsupported surface.", "manualQa.surfaceEvidence.surface");
	}
}

export function checkFile(path: string, field: string, opts?: ValidateQualityGateOptions): void {
	if (opts?.repoRoot === undefined || opts.fs === undefined) return;
	const absolute = resolve(opts.repoRoot, path);
	if (!opts.fs.existsSync(absolute)) invalid(`${field} must point to an existing artifact.`, field);
	if (opts.fs.statSync(absolute).size <= 0) invalid(`${field} must point to a non-empty artifact.`, field);
	if (opts.currentAttemptDir !== undefined && opts.repoRoot !== undefined) {
		const attemptRoot = resolve(opts.repoRoot, opts.currentAttemptDir);
		if (!isWithinAttemptDir(absolute, attemptRoot))
			invalid(
				`${field} (${path}) must point to an artifact from the current attempt (${opts.currentAttemptDir}).`,
				field,
			);
	}
}

export function artifactMap(refs: readonly UlwLoopManualQaArtifactRef[]): Map<string, UlwLoopManualQaArtifactRef> {
	const byId = new Map<string, UlwLoopManualQaArtifactRef>();
	for (const ref of refs) {
		if (byId.has(ref.id)) invalid(`manualQa.artifactRefs contains duplicate ${ref.id}.`, "manualQa.artifactRefs");
		byId.set(ref.id, ref);
	}
	return byId;
}

export function parseArtifactRefs(
	value: unknown,
	opts?: ValidateQualityGateOptions,
): readonly UlwLoopManualQaArtifactRef[] {
	if (!Array.isArray(value) || value.length === 0)
		invalid("manualQa.artifactRefs must not be empty.", "manualQa.artifactRefs");
	return value.map((item, index) => {
		const ref = section(item, `manualQa.artifactRefs[${index}]`);
		const path = textField(ref["path"], `manualQa.artifactRefs[${index}].path`);
		checkFile(path, `manualQa.artifactRefs[${index}].path`, opts);
		return {
			id: textField(ref["id"], `manualQa.artifactRefs[${index}].id`),
			kind: kindField(ref["kind"], `manualQa.artifactRefs[${index}].kind`),
			description: textField(ref["description"], `manualQa.artifactRefs[${index}].description`),
			path,
		};
	});
}

export function referencedArtifacts(
	value: unknown,
	field: string,
	byId: ReadonlyMap<string, UlwLoopManualQaArtifactRef>,
): readonly UlwLoopManualQaArtifactRef[] {
	return stringArray(value, field).map((id) => {
		const artifact = byId.get(id);
		if (artifact === undefined) invalid(`${field} references unknown artifact ${id}.`, field);
		return artifact;
	});
}
