import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ReadonlyFileSystem } from "./types.js";

export type UlwSnapshotSummary = {
	readonly path: string;
	readonly nextAction: string;
};

type SnapshotCandidate = {
	readonly path: string;
	readonly expectedSessionId: string | null;
};

const SNAPSHOT_HEADING = "# ULW Loop Resume Snapshot";
const REQUIRED_SECTIONS = [
	"Metadata",
	"Current State",
	"Criteria",
	"Evidence Summary",
	"Changed Files",
	"Next Action",
	"Safety Notes",
] as const;
const SNAPSHOT_MAX_BYTES = 32 * 1024;
const SECRET_FIXTURE_PATTERNS = [
	/\bAuthorization:\s*(?:Bearer|Basic)\s+[^\r\n]+/i,
	/\b(?:Cookie|Set-Cookie):[^\r\n]+/i,
	/\b(?:[A-Z][A-Z0-9_]*_)?API[-_]?KEY\s*[:=]\s*[^\s\r\n]+/i,
	/\b(?:[A-Z][A-Z0-9_]*_)?TOKEN\s*[:=]\s*[^\s\r\n]+/i,
	/\b(?:[A-Z][A-Z0-9_]*_)?(?:SECRET|PASSWORD|PASSWD|PWD)\s*[:=]\s*[^\s\r\n]+/i,
	/\bsk-[A-Za-z0-9_-]{6,}\b/,
	/\bgh[pousr]_[A-Za-z0-9_]{6,}\b/i,
	/\bgithub_pat_[A-Za-z0-9_]{6,}\b/i,
	/\bxox[abprs]-[A-Za-z0-9-]{6,}\b/i,
	/\bhttps?:\/\/[^\s/:@]+:[^\s@/]+@[^\s)]+/i,
	/BEGIN TRANSCRIPT[\s\S]*?(?:END TRANSCRIPT|$)/,
] as const;
const INSTRUCTION_INJECTION_PATTERNS = [
	/\bignore\s+(?:all\s+)?(?:previous\s+)?instructions\b/i,
	/\b(?:system|developer|assistant|user)\s*:/i,
	/\bsystem\s+override\b/i,
	/\b(?:tool|function)\s+(?:call|command)\b/i,
	/\bexecute\s+(?:shell\s+)?command\b/i,
	/\bprint\s+CANARY(?:[-_][A-Za-z0-9]+)?\b/i,
	/\b(?:BEGIN|END)\s+PROMPT\b/i,
	/<\/?\s*(?:system|developer|assistant|user)\b[^>]*>/i,
] as const;

export function readUlwSnapshotSummary(
	cwd: string,
	sessionId: string,
	worktreePath: string | null,
	fs: ReadonlyFileSystem,
): UlwSnapshotSummary | null {
	const activeRoot = resolveActiveRoot(cwd, worktreePath);
	for (const candidate of snapshotCandidates(activeRoot, sessionId)) {
		const summary = readSnapshotCandidate(candidate, activeRoot, fs);
		if (summary !== null) return summary;
	}
	return null;
}

function snapshotCandidates(cwd: string, sessionId: string): readonly SnapshotCandidate[] {
	const scopedSessionIds = scopedSnapshotSessionIds(sessionId);
	if (scopedSessionIds.length > 0)
		return scopedSessionIds.map((scopedSessionId) => ({
			path: join(cwd, ".omo", "ulw-loop", scopedSessionId, "snapshots", "latest.md"),
			expectedSessionId: scopedSessionId,
		}));
	return [{ path: join(cwd, ".omo", "ulw-loop", "snapshots", "latest.md"), expectedSessionId: null }];
}

function readSnapshotCandidate(
	candidate: SnapshotCandidate,
	activeRoot: string,
	fs: ReadonlyFileSystem,
): UlwSnapshotSummary | null {
	if (!isInside(candidate.path, activeRoot)) return null;
	const markdown = readBoundedText(candidate.path, fs);
	if (markdown === null) return null;
	if (!hasRequiredShape(markdown)) return null;
	if (hasUnsafeText(markdown)) return null;

	const metadata = parseMetadata(markdown);
	if (!metadataMatchesSession(metadata, candidate.expectedSessionId)) return null;
	if (!metadataPointsInsideWorkspace(metadata, activeRoot)) return null;

	const nextAction = parseNextAction(markdown);
	if (nextAction === null || hasUnsafeText(nextAction)) return null;
	return { path: candidate.path, nextAction };
}

function readBoundedText(path: string, fs: ReadonlyFileSystem): string | null {
	try {
		if (fs.statSync(path).size > SNAPSHOT_MAX_BYTES) return null;
		const text = fs.readFileSync(path, "utf8");
		return Buffer.byteLength(text, "utf8") <= SNAPSHOT_MAX_BYTES ? text : null;
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}

function hasRequiredShape(markdown: string): boolean {
	if (!markdown.startsWith(SNAPSHOT_HEADING)) return false;
	return REQUIRED_SECTIONS.every((section) => markdown.includes(`\n## ${section}\n`));
}

function hasUnsafeText(text: string): boolean {
	if (INSTRUCTION_INJECTION_PATTERNS.some((pattern) => pattern.test(text))) return true;
	return SECRET_FIXTURE_PATTERNS.some((pattern) => pattern.test(text));
}

function parseMetadata(markdown: string): ReadonlyMap<string, string> {
	const lines = sectionLines(markdown, "Metadata");
	const entries: [string, string][] = [];
	for (const line of lines) {
		const match = /^-\s*([^:]+):\s*(.+)$/.exec(line);
		if (match === null) continue;
		const [, key, value] = match;
		if (key === undefined || value === undefined) continue;
		entries.push([normalizeMetadataKey(key), value.trim()]);
	}
	return new Map(entries);
}

function metadataMatchesSession(metadata: ReadonlyMap<string, string>, expectedSessionId: string | null): boolean {
	if (expectedSessionId === null) return !metadata.has("sessionid");
	const metadataSessionId = metadata.get("sessionid");
	if (metadataSessionId === undefined) return true;
	return scopedSnapshotSessionIds(metadataSessionId).includes(expectedSessionId);
}

function metadataPointsInsideWorkspace(metadata: ReadonlyMap<string, string>, activeRoot: string): boolean {
	const pathValue = metadata.get("goalspath") ?? metadata.get("planpath");
	if (pathValue === undefined) return false;
	const resolvedPath = resolve(activeRoot, pathValue);
	return isInside(resolvedPath, activeRoot);
}

function parseNextAction(markdown: string): string | null {
	for (const line of sectionLines(markdown, "Next Action")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("- ")) return trimmed.slice("- ".length).trim();
		if (trimmed.length > 0) return trimmed;
	}
	return null;
}

function sectionLines(markdown: string, section: string): readonly string[] {
	const start = markdown.indexOf(`\n## ${section}\n`);
	if (start === -1) return [];
	const contentStart = start + `\n## ${section}\n`.length;
	const nextSection = markdown.indexOf("\n## ", contentStart);
	const contentEnd = nextSection === -1 ? markdown.length : nextSection;
	return markdown.slice(contentStart, contentEnd).split(/\r?\n/);
}

function normalizeMetadataKey(key: string): string {
	return key.replaceAll(/\s+/g, "").toLowerCase();
}

function scopedSnapshotSessionIds(sessionId: string): readonly string[] {
	const trimmed = sessionId.trim();
	if (trimmed.length === 0) return [];

	const withoutCodexPrefix = trimmed.startsWith("codex:") ? trimmed.slice("codex:".length) : trimmed;
	return uniqueNonNull([
		normalizeSnapshotSessionId(`codex:${withoutCodexPrefix}`),
		normalizeSnapshotSessionId(withoutCodexPrefix),
		normalizeSnapshotSessionId(trimmed),
	]);
}

function normalizeSnapshotSessionId(sessionId: string): string | null {
	const trimmed = sessionId.trim();
	if (trimmed.length === 0) return null;
	const pathSegments = trimmed
		.split(/[\\/]+/)
		.filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
	const candidate = (pathSegments.length > 0 ? pathSegments.join("-") : trimmed)
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^\.+/, "")
		.replace(/^[.-]+|[.-]+$/g, "");
	return candidate.length > 0 ? candidate : null;
}

function uniqueNonNull(values: readonly (string | null)[]): readonly string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const value of values) {
		if (value === null || seen.has(value)) continue;
		seen.add(value);
		unique.push(value);
	}
	return unique;
}

function resolveActiveRoot(cwd: string, worktreePath: string | null): string {
	const trimmed = worktreePath?.trim();
	return trimmed === undefined || trimmed.length === 0 ? resolve(cwd) : resolve(cwd, trimmed);
}

function isInside(path: string, root: string): boolean {
	const relativePath = relative(resolve(root), resolve(path));
	return (
		relativePath.length === 0 ||
		(!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))
	);
}
