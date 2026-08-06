import { createHash } from "node:crypto";

import { canonicalizeWorkspaceApplyEditFailureReason } from "./workspace-apply-edit-failure.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeWorkspaceEditContractEvidence(value: unknown, workspace: string): unknown {
	if (typeof value === "string") return value.replaceAll(workspace, "<workspace>");
	if (Array.isArray(value)) return value.map((entry) => normalizeWorkspaceEditContractEvidence(entry, workspace));
	if (!isRecord(value)) return value;
	const normalized: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		const entry = normalizeWorkspaceEditContractEvidence(value[key], workspace);
		normalized[key] =
			key === "failureReason" && typeof entry === "string"
				? canonicalizeWorkspaceApplyEditFailureReason(entry)
				: entry;
	}
	return normalized;
}

export function workspaceEditContractFailureEvidence(value: unknown, workspace: string) {
	const normalized = normalizeWorkspaceEditContractEvidence(value, workspace);
	return {
		normalized,
		sha256: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
	};
}
