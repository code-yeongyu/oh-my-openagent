import type { WorkspaceEdit } from "./types.js";
import { workspaceApplyEditConcurrentFailureReason } from "./workspace-apply-edit-failure.js";
import { commitWorkspaceEditPlan } from "./workspace-edit-commit.js";
import { fingerprintWorkspaceEdit, planWorkspaceEdit } from "./workspace-edit-plan.js";
import type {
	ApplyResult,
	LspRenameResult,
	WorkspaceEditCommitIo,
} from "./workspace-edit-types.js";
import { WorkspaceDocumentState } from "./workspace-document-state.js";

export interface WorkspaceApplyEditResponse {
	readonly applied: boolean;
	readonly failureReason?: string;
	readonly failedChange?: number;
}

export interface WorkspaceMutationLease {
	readonly id: number;
}

interface ServerApplyRecord {
	readonly fingerprint: string | null;
	readonly result: ApplyResult;
}

interface ActiveLease extends WorkspaceMutationLease {
	readonly signal?: AbortSignal;
	phase: "idle" | "applying" | "settled" | "sealed";
	serverApply?: ServerApplyRecord;
	applyCompletion?: Promise<void>;
	resolveApply?: () => void;
}

export type AcquireMutationLeaseResult =
	| { readonly success: true; readonly lease: WorkspaceMutationLease }
	| { readonly success: false; readonly result: ApplyResult };

function failure(message: string, failedChange?: number, base?: ApplyResult): ApplyResult {
	return {
		success: false,
		filesModified: base?.filesModified ?? [],
		totalEdits: base?.totalEdits ?? 0,
		errors: [message],
		...(failedChange === undefined ? {} : { failedChange }),
		...(base?.lateAbort ? { lateAbort: true } : {}),
	};
}

function responseFor(result: ApplyResult): WorkspaceApplyEditResponse {
	if (result.success) return { applied: true };
	return {
		applied: false,
		failureReason: result.errors[0] ?? "workspace edit failed",
		...(result.failedChange === undefined ? {} : { failedChange: result.failedChange }),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class WorkspaceMutationController {
	private activeLease: ActiveLease | null = null;
	private nextLeaseId = 1;
	private io: Partial<WorkspaceEditCommitIo> | undefined;

	constructor(
		private readonly workspaceRoot: string,
		private readonly documents: WorkspaceDocumentState,
	) {}

	setIo(io: Partial<WorkspaceEditCommitIo>): void {
		this.io = io;
	}

	acquire(signal?: AbortSignal): AcquireMutationLeaseResult {
		if (this.activeLease) return { success: false, result: failure("workspace mutation is already in progress") };
		if (signal?.aborted) return { success: false, result: failure("cancelled before mutating request") };
		const lease: ActiveLease = {
			id: this.nextLeaseId,
			phase: "idle",
			...(signal === undefined ? {} : { signal }),
		};
		this.nextLeaseId += 1;
		this.activeLease = lease;
		return { success: true, lease };
	}

	release(lease: WorkspaceMutationLease): void {
		if (this.activeLease?.id !== lease.id) return;
		this.activeLease.phase = "sealed";
		this.activeLease = null;
	}

	isBeforeCommit(lease: WorkspaceMutationLease): boolean {
		return this.activeLease?.id === lease.id && this.activeLease.phase === "idle";
	}

	async handleApplyEdit(params: unknown): Promise<WorkspaceApplyEditResponse> {
		const lease = this.activeLease;
		if (!lease) return { applied: false, failureReason: "workspace/applyEdit requires an active workspace mutation" };
		if (lease.phase !== "idle") {
			return {
				applied: false,
				failureReason: workspaceApplyEditConcurrentFailureReason(lease.phase === "applying" ? "applying" : "settled"),
			};
		}

		lease.phase = "applying";
		lease.applyCompletion = new Promise<void>((resolve) => {
			lease.resolveApply = resolve;
		});
		const edit = isRecord(params) ? params["edit"] : undefined;
		const record =
			edit === undefined
				? { fingerprint: null, result: failure("workspace/applyEdit params.edit is required", 0) }
				: await this.applyEdit(edit, lease);
		lease.serverApply = record;
		lease.phase = "settled";
		lease.resolveApply?.();
		return responseFor(record.result);
	}

	async reconcileRename(
		leaseToken: WorkspaceMutationLease,
		edit: WorkspaceEdit | null,
	): Promise<LspRenameResult> {
		const lease = this.requireActiveLease(leaseToken);
		if (!lease) return { edit, apply: failure("workspace mutation lease ended before rename reconciliation") };
		if (lease.phase === "applying") await lease.applyCompletion;
		if (lease.serverApply) return this.reconcileServerApply(lease.serverApply, edit);
		lease.phase = "sealed";
		if (!edit) return { edit, apply: failure("No edit provided") };
		const applied = await this.applyEdit(edit, lease);
		return { edit, apply: applied.result };
	}

	private reconcileServerApply(record: ServerApplyRecord, edit: WorkspaceEdit | null): LspRenameResult {
		if (!edit) return { edit, apply: record.result };
		const fingerprint = fingerprintWorkspaceEdit(edit, this.workspaceRoot);
		if (fingerprint.success && record.fingerprint !== null && fingerprint.fingerprint === record.fingerprint) {
			return { edit, apply: record.result };
		}
		return {
			edit,
			apply: failure("rename result conflicts with server-applied workspace edit", 0, record.result),
		};
	}

	private async applyEdit(edit: unknown, lease: ActiveLease): Promise<ServerApplyRecord> {
		const planned = planWorkspaceEdit(edit, this.workspaceRoot);
		if (!planned.success) return { fingerprint: null, result: planned.result };
		const versionFailure = this.documents.validateVersions(planned.plan.operations);
		if (versionFailure) {
			return {
				fingerprint: planned.plan.fingerprint,
				result: failure(versionFailure.message, versionFailure.changeIndex),
			};
		}

		const commit = commitWorkspaceEditPlan(planned.plan, {
			...(lease.signal === undefined ? {} : { signal: lease.signal }),
			...(this.io === undefined ? {} : { io: this.io }),
		});
		let result = commit.result;
		if (commit.delta.operations.length > 0) {
			try {
				await this.documents.synchronize(commit.delta);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				result = failure(`document synchronization failed after filesystem commit: ${message}`, undefined, result);
			}
		}
		if (lease.signal?.aborted && !result.lateAbort) result = { ...result, lateAbort: true };
		return { fingerprint: planned.plan.fingerprint, result };
	}

	private requireActiveLease(lease: WorkspaceMutationLease): ActiveLease | null {
		return this.activeLease?.id === lease.id ? this.activeLease : null;
	}
}
