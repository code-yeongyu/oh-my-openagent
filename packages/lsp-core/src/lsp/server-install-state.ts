import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { lspRequestContext } from "../request-context.js";

export type InstallDecision = "declined" | "allowed";

export interface InstallDecisionRecord {
	readonly decision: InstallDecision;
	readonly decidedAt: string;
}

type InstallDecisions = Record<string, InstallDecisionRecord>;

export function getInstallDecisionsPath(): string {
	return lspRequestContext().installDecisionsPath;
}

export function loadInstallDecisions(): InstallDecisions {
	const path = getInstallDecisionsPath();
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return isInstallDecisions(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

export function loadInstallDecision(serverId: string): InstallDecisionRecord | undefined {
	return loadInstallDecisions()[serverId];
}

export function recordInstallDecision(
	serverId: string,
	decision: InstallDecision,
	decidedAt: string = new Date().toISOString(),
): void {
	const decisions = loadInstallDecisions();
	decisions[serverId] = { decision, decidedAt };
	writeInstallDecisions(decisions);
}

export function isInstallDecision(value: unknown): value is InstallDecision {
	return value === "declined" || value === "allowed";
}

function writeInstallDecisions(decisions: InstallDecisions): void {
	const path = getInstallDecisionsPath();
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = `${path}.tmp`;
	writeFileSync(tmpPath, `${JSON.stringify(decisions, null, 2)}\n`, "utf8");
	renameSync(tmpPath, path);
}

function isInstallDecisions(value: unknown): value is InstallDecisions {
	return isRecord(value) && Object.values(value).every(isInstallDecisionRecord);
}

function isInstallDecisionRecord(value: unknown): value is InstallDecisionRecord {
	if (!isRecord(value)) return false;
	return isInstallDecision(value["decision"]) && typeof value["decidedAt"] === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
