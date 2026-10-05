import { resolve } from "node:path";
import { isWithinAttemptDir } from "./paths.js";
import type { ValidateQualityGateOptions } from "./quality-gate.js";
import {
	invalid,
	isPoisoned,
	markPoisonedArtifactKind,
	section,
	stringArray,
	textField,
} from "./quality-gate-fields.js";
import type { UlwLoopManualQaArtifactKind, UlwLoopManualQaArtifactRef, UlwLoopManualQaSurface } from "./types.js";

export const SUPPORTED_SURFACES: readonly UlwLoopManualQaSurface[] = ["cli", "http", "tmux", "browser", "gui", "data"];
export const SUPPORTED_KINDS: readonly UlwLoopManualQaArtifactKind[] = [
	"cli-transcript",
	"log",
	"screenshot",
	"image",
	"http-dump",
	"data-diff",
];
const COMPATIBLE_KINDS: Readonly<Record<UlwLoopManualQaSurface, readonly UlwLoopManualQaArtifactKind[]>> = {
	cli: ["cli-transcript", "log"],
	tmux: ["cli-transcript", "log"],
	http: ["http-dump"],
	browser: ["screenshot", "image"],
	gui: ["screenshot", "image"],
	data: ["data-diff"],
};

function isSupportedSurface(value: unknown): value is UlwLoopManualQaSurface {
	return SUPPORTED_SURFACES.some((surface) => surface === value);
}
function isSupportedKind(value: unknown): value is UlwLoopManualQaArtifactKind {
	return SUPPORTED_KINDS.some((kind) => kind === value);
}

export function surfaceField(value: unknown, field: string): UlwLoopManualQaSurface {
	if (isSupportedSurface(value)) return value;
	invalid(`${field} must be a supported manual QA surface (${SUPPORTED_SURFACES.join(", ")}).`, field);
	return "cli";
}
export function kindField(value: unknown, field: string): UlwLoopManualQaArtifactKind {
	if (isSupportedKind(value)) return value;
	invalid(
		`${field} must be a supported artifact kind (${SUPPORTED_KINDS.join(", ")}); review/QA reports belong in codeReview.reportPath or gateReview.reportPath, not artifactRefs.`,
		field,
	);
	return "log";
}
export function compatibleKindsFor(surface: UlwLoopManualQaSurface): readonly UlwLoopManualQaArtifactKind[] {
	return COMPATIBLE_KINDS[surface];
}
export function artifactCompatible(surface: UlwLoopManualQaSurface, kind: UlwLoopManualQaArtifactKind): boolean {
	return compatibleKindsFor(surface).includes(kind);
}
export function checkFile(path: string, field: string, opts?: ValidateQualityGateOptions): void {
	if (opts?.repoRoot === undefined || opts.fs === undefined || isPoisoned(field)) return;
	const absolute = resolve(opts.repoRoot, path);
	if (!opts.fs.existsSync(absolute)) {
		invalid(`${field} must point to an existing artifact.`, field);
		return;
	}
	if (opts.fs.statSync(absolute).size <= 0) invalid(`${field} must point to a non-empty artifact.`, field);
	if (
		opts.currentAttemptDir !== undefined &&
		!isWithinAttemptDir(absolute, resolve(opts.repoRoot, opts.currentAttemptDir))
	)
		invalid(
			`${field} (${path}) must point to an artifact from the current attempt (${opts.currentAttemptDir}).`,
			field,
		);
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
	if (!Array.isArray(value) || value.length === 0) {
		invalid("manualQa.artifactRefs must not be empty.", "manualQa.artifactRefs");
		return [];
	}
	return value.flatMap((item, index) => {
		const prefix = `manualQa.artifactRefs[${index}]`;
		const ref = section(item, prefix);
		if (isPoisoned(prefix)) return [];
		const pathField = `${prefix}.path`;
		const idField = `${prefix}.id`;
		const kindFieldName = `${prefix}.kind`;
		const descriptionField = `${prefix}.description`;
		const path = textField(ref["path"], pathField);
		const id = textField(ref["id"], idField);
		const kind = kindField(ref["kind"], kindFieldName);
		if (isPoisoned(kindFieldName)) markPoisonedArtifactKind(id);
		const description = textField(ref["description"], descriptionField);
		checkFile(path, pathField, opts);
		return [{ id, kind, description, path }];
	});
}
export function referencedArtifacts(
	value: unknown,
	field: string,
	byId: ReadonlyMap<string, UlwLoopManualQaArtifactRef>,
): readonly UlwLoopManualQaArtifactRef[] {
	const ids = stringArray(value, field);
	if (isPoisoned(field)) return [];
	return ids.flatMap((id) => {
		const artifact = byId.get(id);
		if (artifact === undefined) {
			invalid(`${field} references unknown artifact ${id}.`, field);
			return [];
		}
		return [artifact];
	});
}
