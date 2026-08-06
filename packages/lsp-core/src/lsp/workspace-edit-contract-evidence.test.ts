import { describe, expect, it } from "bun:test";

import {
	CANONICAL_CONCURRENT_WORKSPACE_APPLY_EDIT_FAILURE_REASON,
	workspaceApplyEditConcurrentFailureReason,
} from "./workspace-apply-edit-failure.js";
import {
	normalizeWorkspaceEditContractEvidence,
	workspaceEditContractFailureEvidence,
} from "./workspace-edit-contract-evidence.js";

describe("workspace edit contract evidence", () => {
	it("#given both legitimate concurrent applyEdit lease outcomes #when failure evidence is hashed #then one canonical shape and hash is produced", () => {
		const workspace = "/tmp/workspace-edit-contract";
		const applying = workspaceEditContractFailureEvidence(
			{
				applied: false,
				failureReason: workspaceApplyEditConcurrentFailureReason("applying"),
			},
			workspace,
		);
		const settled = workspaceEditContractFailureEvidence(
			{
				applied: false,
				failureReason: workspaceApplyEditConcurrentFailureReason("settled"),
			},
			workspace,
		);

		expect(applying.normalized).toEqual({
			applied: false,
			failureReason: CANONICAL_CONCURRENT_WORKSPACE_APPLY_EDIT_FAILURE_REASON,
		});
		expect(settled.normalized).toEqual(applying.normalized);
		expect(settled.sha256).toBe(applying.sha256);
	});

	it("#given workspace-scoped evidence and a non-concurrent failure #when normalized #then paths are sanitized and the reason is preserved", () => {
		const workspace = "/tmp/workspace-edit-contract";

		expect(
			normalizeWorkspaceEditContractEvidence(
				{
					applied: false,
					failureReason: "document version 9 does not match open document version 1 for /tmp/workspace-edit-contract/source.ts",
					nested: ["/tmp/workspace-edit-contract/source.ts"],
				},
				workspace,
			),
		).toEqual({
			applied: false,
			failureReason: "document version 9 does not match open document version 1 for <workspace>/source.ts",
			nested: ["<workspace>/source.ts"],
		});
	});
});
