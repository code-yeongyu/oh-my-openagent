import type { EngineMethod, ErrorCode } from "./engine-schema.generated";

/** Outcome of one audited desktop action. */
export type AuditStatus = "success" | "error" | "suspended";

/** The first failure of an audited action, as reported to the model. */
export interface AuditPrimaryError {
	readonly code: ErrorCode;
	readonly message: string;
}

/**
 * One persisted audit line: the engine `AuditEvent` plus run context. FROZEN field set;
 * the engine audit writer (todo 22) persists exactly these fields.
 */
export interface AuditRecord {
	/** ISO-8601 UTC timestamp. */
	readonly timestamp: string;
	readonly sessionId: string;
	readonly runId: string;
	readonly action: EngineMethod;
	readonly target: string;
	/** `background` or `foreground`. */
	readonly delivery: string;
	readonly frameId: string | null;
	/** `null` when the action succeeded. */
	readonly code: ErrorCode | null;
	readonly status: AuditStatus;
	readonly primaryError?: AuditPrimaryError;
	readonly durationMs: number;
	readonly focusRestored?: boolean;
	readonly screenshotPath?: string;
	readonly screenshotWidth?: number;
	readonly screenshotHeight?: number;
	readonly textLength?: number;
	/** First 16 hex digits of the typed text's SHA-256; the text itself is never audited. */
	readonly textSha256?: string;
	readonly keys?: readonly string[];
	readonly message?: string;
}
