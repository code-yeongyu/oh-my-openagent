import { isAbsolute, join, relative, sep } from "node:path";
import {
	ULW_LOOP_BRIEF,
	ULW_LOOP_DIR,
	ULW_LOOP_GOALS,
	ULW_LOOP_LATEST_SNAPSHOT,
	ULW_LOOP_LEDGER,
	ULW_LOOP_SNAPSHOTS,
} from "./types.js";

export interface UlwLoopScope {
	readonly sessionId?: string | null;
}

const SESSION_ENV_KEYS = ["OMO_ULW_LOOP_SESSION_ID", "CODEX_SESSION_ID", "CODEX_THREAD_ID"] as const;
type EnvMap = Readonly<Record<string, string | undefined>>;

export function normalizeUlwLoopSessionId(sessionId: string | null | undefined): string | null {
	const trimmed = sessionId?.trim();
	if (!trimmed) return null;
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

export function resolveUlwLoopSessionIdFromEnv(env: EnvMap = process.env): string | null {
	for (const key of SESSION_ENV_KEYS) {
		const normalized = normalizeUlwLoopSessionId(env[key]);
		if (normalized !== null) return normalized;
	}
	return null;
}

export function ulwLoopRelativeDir(scope?: UlwLoopScope): string {
	const sessionId = normalizeUlwLoopSessionId(scope?.sessionId);
	return sessionId === null ? ULW_LOOP_DIR : `${ULW_LOOP_DIR}/${sessionId}`;
}

export function ulwLoopDir(repoRoot: string, scope?: UlwLoopScope): string {
	return join(repoRoot, ulwLoopRelativeDir(scope));
}

export function ulwLoopBriefRelativePath(scope?: UlwLoopScope): string {
	return `${ulwLoopRelativeDir(scope)}/${ULW_LOOP_BRIEF}`;
}

export function ulwLoopGoalsRelativePath(scope?: UlwLoopScope): string {
	return `${ulwLoopRelativeDir(scope)}/${ULW_LOOP_GOALS}`;
}

export function ulwLoopLedgerRelativePath(scope?: UlwLoopScope): string {
	return `${ulwLoopRelativeDir(scope)}/${ULW_LOOP_LEDGER}`;
}

export function ulwLoopSnapshotRelativePath(scope?: UlwLoopScope): string {
	return `${ulwLoopRelativeDir(scope)}/${ULW_LOOP_SNAPSHOTS}/${ULW_LOOP_LATEST_SNAPSHOT}`;
}

export function ulwLoopBriefPath(repoRoot: string, scope?: UlwLoopScope): string {
	return join(ulwLoopDir(repoRoot, scope), ULW_LOOP_BRIEF);
}

export function ulwLoopGoalsPath(repoRoot: string, scope?: UlwLoopScope): string {
	return join(ulwLoopDir(repoRoot, scope), ULW_LOOP_GOALS);
}

export function ulwLoopLedgerPath(repoRoot: string, scope?: UlwLoopScope): string {
	return join(ulwLoopDir(repoRoot, scope), ULW_LOOP_LEDGER);
}

export function ulwLoopSnapshotPath(repoRoot: string, scope?: UlwLoopScope): string {
	return join(repoRoot, ulwLoopSnapshotRelativePath(scope));
}

export function repoRelative(absolutePath: string, repoRoot: string): string {
	const slashPrefix = `${repoRoot}/`;
	const backslashPrefix = `${repoRoot}\\`;
	if (absolutePath.startsWith(slashPrefix)) return absolutePath.slice(slashPrefix.length).split("\\").join("/");
	if (absolutePath.startsWith(backslashPrefix))
		return absolutePath.slice(backslashPrefix.length).split("\\").join("/");
	return absolutePath.split("\\").join("/");
}

// Both the status --json emitter and the checkpoint enforcement resolve the attempt dir through
// this function; a second resolution path would let the gate reject its own advertised directory.
export function ulwLoopAttemptEvidenceDir(goalId: string, attempt: number, scope?: UlwLoopScope): string {
	const sessionId = normalizeUlwLoopSessionId(scope?.sessionId) ?? resolveUlwLoopSessionIdFromEnv() ?? "session";
	return `.omo/evidence/ulw/${sessionId}/${goalId}/a${attempt}`;
}

interface AttemptPathApi {
	relative(from: string, to: string): string;
	isAbsolute(path: string): boolean;
	readonly sep: string;
}

const PLATFORM_PATH_API: AttemptPathApi = { relative, isAbsolute, sep };

export function isWithinAttemptDir(
	absolutePath: string,
	attemptRoot: string,
	pathApi: AttemptPathApi = PLATFORM_PATH_API,
): boolean {
	const relativePath = pathApi.relative(attemptRoot, absolutePath);
	if (relativePath === "") return true;
	if (relativePath === ".." || relativePath.startsWith(`..${pathApi.sep}`)) return false;
	return !pathApi.isAbsolute(relativePath);
}
