import {
	type AuditEvent,
	type DesktopCapabilities,
	ENGINE_METHODS,
	ERROR_CODES,
	type JsonRpcErrorData,
	type MethodRejection,
	type PermissionDeniedData,
	type StopPathStatus,
	UNKNOWN_AUDIT_VALUE,
} from "@oh-my-opencode/senpi-desktop-protocol";

// Engine stdout is the trust boundary: every payload the service hands out is shape-checked here.

type FieldKind = "string" | "boolean" | "number";
export type FieldSpec = Readonly<Record<string, FieldKind | `${FieldKind}?`>>;

const STOP_PATH_KINDS: ReadonlySet<string> = new Set(["global", "host-relay", "none"]);
const METHOD_REJECTIONS = ["unknown", "hostOnly", "testOnly"] as const satisfies readonly MethodRejection[];

const STOP_PATH_STATUS: FieldSpec = {
	suspended: "boolean",
	globalLive: "boolean",
	hostRelayLive: "boolean",
	heartbeatFresh: "boolean",
	stopPath: "string",
	reason: "string?",
};

const CAPABILITIES: FieldSpec = {
	backend: "string",
	displayServer: "string?",
	capture: "boolean",
	input: "boolean",
	ax: "boolean",
	backgroundWindowInput: "boolean",
	cursorOverlay: "boolean?",
	// Optional so this host still opens an engine from before or after their release (macOS shared-screen parity).
	interventionWatch: "string?",
	displayAsleep: "boolean?",
	capturePermission: "string",
	inputPermission: "string",
	axPermission: "string",
	displayCount: "number",
	focusGuard: "boolean",
	stopPath: "string",
	stopReason: "string?",
	integrityLevel: "string?",
	screenLocked: "boolean",
};

const AUDIT_EVENT: FieldSpec = {
	action: "string",
	target: "string",
	delivery: "string",
	frameId: "string?",
	code: "string?",
	durationMs: "number",
	focusRestored: "boolean?",
	textLength: "number?",
	textDelivered: "number?",
	textSha256: "string?",
};

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function matches(value: unknown, spec: FieldSpec): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	return Object.entries(spec).every(([key, kind]) => {
		const field = value[key];
		if (!kind.endsWith("?")) return typeof field === kind;
		return field === undefined || field === null || typeof field === kind.slice(0, -1);
	});
}

export function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isMember(value: unknown, names: ReadonlySet<string>): boolean {
	return typeof value === "string" && names.has(value);
}

export function isStopPathStatus(value: unknown): value is StopPathStatus {
	return matches(value, STOP_PATH_STATUS) && isMember(value.stopPath, STOP_PATH_KINDS);
}

export function isDesktopCapabilities(
	value: unknown,
): value is Omit<DesktopCapabilities, "cursorOverlay"> & { readonly cursorOverlay?: boolean } {
	return matches(value, CAPABILITIES) && isStringArray(value.deliveryModes)
		&& (value.cursorOverlay === undefined || typeof value.cursorOverlay === "boolean");
}

type AuditEventShape = Omit<AuditEvent, "action" | "code"> & {
	readonly action: string;
	readonly code?: string | null;
};

function isAuditEventShape(value: unknown): value is AuditEventShape {
	return matches(value, AUDIT_EVENT) && (value.keys === undefined || value.keys === null || isStringArray(value.keys));
}

/**
 * An `audit` payload, or `undefined` when it is malformed. An action or code this host does not know (sent by a
 * newer engine) reads as `"unknown"`: the event is kept, never dropped, so the audit trail stays complete.
 */
export function parseAuditEvent(value: unknown): AuditEvent | undefined {
	if (!isAuditEventShape(value)) return undefined;
	const action = ENGINE_METHODS.find((name) => name === value.action) ?? UNKNOWN_AUDIT_VALUE;
	const { code } = value;
	if (code === undefined || code === null) return { ...value, action, code };
	return { ...value, action, code: ERROR_CODES.find((name) => name === code) ?? UNKNOWN_AUDIT_VALUE };
}

/** The contract fields of an `engine.hello` result, or `undefined` when it is malformed. */
export function parseHello(value: unknown): { readonly abi: string; readonly protocolVersion: string } | undefined {
	if (!isRecord(value) || typeof value.abi !== "string" || typeof value.protocolVersion !== "string") return undefined;
	return { abi: value.abi, protocolVersion: value.protocolVersion };
}

export interface SessionOpened {
	readonly capabilities: DesktopCapabilities;
	readonly resumeToken: string;
}

export function parseSessionOpened(value: unknown): SessionOpened | undefined {
	if (!isRecord(value) || typeof value.resumeToken !== "string" || !isDesktopCapabilities(value.capabilities)) {
		return undefined;
	}
	return {
		capabilities: { ...value.capabilities, cursorOverlay: value.capabilities.cursorOverlay ?? false },
		resumeToken: value.resumeToken,
	};
}

/** `data` of an engine error: an `ErrorCode` failure, a `-32601` rejection, or nothing this host knows. */
export function parseErrorData(value: unknown): JsonRpcErrorData | null {
	if (!isRecord(value)) return null;
	const code = ERROR_CODES.find((name) => name === value.code);
	if (code !== undefined) {
		const permission = parsePermission(value.permission);
		return {
			code,
			hint: typeof value.hint === "string" ? value.hint : null,
			...(permission === undefined ? {} : { permission }),
		};
	}
	const reason = METHOD_REJECTIONS.find((name) => name === value.reason);
	return reason === undefined ? null : { reason };
}

function parsePermission(value: unknown): PermissionDeniedData | undefined {
	if (
		!isRecord(value) ||
		(value.permission !== "screen_recording" && value.permission !== "accessibility") ||
		typeof value.settingsUrl !== "string" ||
		typeof value.app !== "string" ||
		typeof value.relaunchRequired !== "boolean"
	) return undefined;
	return {
		permission: value.permission,
		settingsUrl: value.settingsUrl,
		app: value.app,
		relaunchRequired: value.relaunchRequired,
	};
}
