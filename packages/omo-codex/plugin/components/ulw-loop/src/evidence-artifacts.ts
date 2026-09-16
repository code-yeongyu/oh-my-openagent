import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { UlwLoopError } from "./types.js";

function fail(message: string, code: string, details: Record<string, unknown>): never {
	throw new UlwLoopError(message, code, { details });
}

function stored(repoRoot: string, absolute: string): string {
	const rel = relative(repoRoot, absolute);
	const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
	return inside ? rel.split(sep).join("/") : absolute;
}

// Artifacts are bound at record time: a cited path that does not exist is a claim without a file,
// so the whole record is refused before any state changes. Paths inside the session cwd persist
// repo-relative (portable across machines); paths outside persist absolute.
export function resolveEvidenceArtifacts(
	repoRoot: string,
	artifacts: readonly unknown[] | undefined,
): string[] | undefined {
	if (artifacts === undefined) return undefined;
	const seen = new Set<string>();
	const resolved: string[] = [];
	for (const [index, candidate] of artifacts.entries()) {
		const path = typeof candidate === "string" ? candidate.trim() : "";
		if (!path) fail(`Artifact ${index + 1} must be a non-empty path.`, "ULW_LOOP_ARGUMENT_INVALID", { index });
		const absolute = resolve(repoRoot, path);
		if (!existsSync(absolute))
			fail(
				`Evidence artifact does not exist: ${path} (resolved to ${absolute}).`,
				"ULW_LOOP_EVIDENCE_ARTIFACT_MISSING",
				{
					path,
					resolved: absolute,
				},
			);
		const value = stored(repoRoot, absolute);
		if (!seen.has(value)) {
			seen.add(value);
			resolved.push(value);
		}
	}
	return resolved;
}
