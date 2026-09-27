import type { EngineMethod, ErrorCode } from "./engine-schema.generated";

/** Which stop path currently guards input. */
export type StopPathKind = "global" | "host-relay" | "none";

/** `stopPath.*` reply and the `stopPath.changed` notification payload. */
export interface StopPathStatus {
	readonly suspended: boolean;
	readonly globalLive: boolean;
	readonly hostRelayLive: boolean;
	readonly heartbeatFresh: boolean;
	readonly stopPath: StopPathKind;
	/** Why input is not allowed, when it is not (e.g. `no-global-listener`, `heartbeat-stale`). */
	readonly reason?: string | null;
}

export type LogLevel = "error" | "warn" | "info" | "debug";

/** The `engine.log` notification payload. */
export interface EngineLog {
	readonly level: LogLevel;
	readonly message: string;
}

/** The `audit` notification payload: one per mutating request, success or failure. */
export interface AuditEvent {
	readonly action: EngineMethod;
	readonly target: string;
	/** `background` or `foreground`. */
	readonly delivery: string;
	readonly frameId?: string | null;
	/** `null` when the request succeeded. */
	readonly code?: ErrorCode | null;
	readonly durationMs: number;
	readonly focusRestored?: boolean | null;
	readonly textLength?: number | null;
	/** First 16 hex digits of the typed text's SHA-256; the text itself is never audited. */
	readonly textSha256?: string | null;
	readonly keys?: readonly string[] | null;
}

/** Runtime truth about what this host's backend can do right now (frozen field set). */
export interface DesktopCapabilities {
	readonly backend: string;
	readonly displayServer?: string | null;
	readonly capture: boolean;
	readonly input: boolean;
	readonly ax: boolean;
	readonly backgroundWindowInput: boolean;
	readonly deliveryModes: readonly string[];
	readonly capturePermission: string;
	readonly inputPermission: string;
	readonly axPermission: string;
	readonly displayCount: number;
	/** Whether foreground delivery restores the previous front window and cursor. */
	readonly focusGuard: boolean;
	/** Live stop path: `global`, `host-relay`, or `none`. */
	readonly stopPath: string;
	/** Why the stop path is not `global`, when it is not. */
	readonly stopReason?: string | null;
	/** Windows mandatory integrity level of the engine process. */
	readonly integrityLevel?: string | null;
	readonly screenLocked: boolean;
}
