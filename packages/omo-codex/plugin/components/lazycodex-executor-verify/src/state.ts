import { join } from "node:path";

import type { HookFileSystem } from "./types.js";

export const MAX_ATTEMPTS = 3;

export type AttemptState = {
	readonly attempts: number;
};

export function readAttemptState(cwd: string, sessionId: string, agentId: string, fs: HookFileSystem): AttemptState {
	const statePath = getStatePath(cwd, sessionId, agentId);
	if (!fs.existsSync(statePath)) return { attempts: 0 };
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(statePath, "utf8"));
		if (isAttemptState(parsed)) return parsed;
		return { attempts: 0 };
	} catch (error) {
		if (error instanceof SyntaxError || error instanceof Error) return { attempts: 0 };
		throw error;
	}
}

export function writeAttemptState(
	cwd: string,
	sessionId: string,
	agentId: string,
	state: AttemptState,
	fs: HookFileSystem,
): void {
	const stateDir = getStateDir(cwd);
	const statePath = getStatePath(cwd, sessionId, agentId);
	const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
	fs.mkdirSync(stateDir, { recursive: true });
	fs.writeFileSync(tempPath, `${JSON.stringify(state)}\n`);
	fs.renameSync(tempPath, statePath);
}

export function clearAttemptState(cwd: string, sessionId: string, agentId: string, fs: HookFileSystem): void {
	fs.rmSync(getStatePath(cwd, sessionId, agentId), { force: true });
}

export function getStatePath(cwd: string, sessionId: string, agentId: string): string {
	return join(getStateDir(cwd), `${sanitizeKey(sessionId)}-${sanitizeKey(agentId)}.json`);
}

function getStateDir(cwd: string): string {
	return join(cwd, ".omo", "lazycodex-executor-verify");
}

function sanitizeKey(value: string): string {
	const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return sanitized.length > 0 ? sanitized : "missing";
}

function isAttemptState(value: unknown): value is AttemptState {
	return isRecord(value) && typeof value["attempts"] === "number" && Number.isInteger(value["attempts"]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
