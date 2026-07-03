import type { HookDiagnostic, HookDiagnosticCode, HookSourceMetadata } from "./types.ts";

export type DiagnosticDraft = {
	readonly code: HookDiagnosticCode;
	readonly message: string;
	readonly path: string;
	readonly event?: string;
	readonly severity?: "error" | "warning";
};

export function diagnostic(draft: DiagnosticDraft, source: HookSourceMetadata): HookDiagnostic {
	const base = {
		code: draft.code,
		message: draft.message,
		path: draft.path,
		severity: draft.severity ?? "error",
		source,
	};
	if (draft.event === undefined) {
		return base;
	}
	return { ...base, event: draft.event };
}
