import { APP_SERVER_SURFACE_INVENTORY } from "./protocol-inventory.ts";
import type { AppServerClientRequestSurface } from "./protocol-required-surfaces.ts";

export { APP_SERVER_SURFACE_INVENTORY } from "./protocol-inventory.ts";

export const PI_CODEX_APP_SERVER_PROTOCOL_VERSION = "2026-06-24.pr-001";

export type CoreExternalProtocolMethodName =
	| "initialize"
	| "initialized"
	| "session/new"
	| "session/resume"
	| "session/fork"
	| "session/list"
	| "session/read"
	| "session/archive"
	| "session/delete"
	| "session/unsubscribe"
	| "turn/start"
	| "turn/steer"
	| "turn/interrupt"
	| "callback/respond"
	| "callback/reject"
	| "appServer/event"
	| "appServer/request"
	| "appServer/response"
	| "lag"
	| "disconnect"
	| "resume";
export type ExternalProtocolMethodName = CoreExternalProtocolMethodName | AppServerClientRequestSurface;

export type StreamClass = "lossless" | "best-effort" | "snapshot-authoritative" | "control";
export type RelayClass = "semantic" | "opaque-lossless" | "opaque-best-effort" | "snapshot-authoritative";
export type SurfaceDirection = "external-to-app" | "app-to-external" | "bidirectional";

export interface ExternalProtocolMethod {
	readonly name: ExternalProtocolMethodName;
	readonly direction: SurfaceDirection;
	readonly streamClass: StreamClass;
	readonly capabilityGate: string;
	readonly errorBehavior: string;
}

export interface OpaqueEnvelopeField {
	readonly name: string;
	readonly required: boolean;
	readonly description: string;
}

export interface AppServerSurfaceInventoryEntry {
	readonly method: string;
	readonly direction: SurfaceDirection;
	readonly relayClass: RelayClass;
	readonly streamClass: StreamClass;
	readonly surface: string;
	readonly idFields: readonly string[];
	readonly source: string;
}

export interface ReviewerEvidencePacketTemplate {
	readonly summaryFile: string;
	readonly commandsFile: string;
	readonly inventoryDiff: string;
	readonly cleanupReceipt: string;
	readonly secretSafety: string;
	readonly residualRisks: string;
}

export const EXTERNAL_PROTOCOL_METHODS: readonly ExternalProtocolMethod[] = [
	{
		name: "initialize",
		direction: "external-to-app",
		streamClass: "control",
		capabilityGate: "opaque notifications and opaque callbacks",
		errorBehavior: "Reject incompatible clients before any app-server request is routed.",
	},
	{
		name: "initialized",
		direction: "external-to-app",
		streamClass: "control",
		capabilityGate: "initialize accepted",
		errorBehavior: "Return method-order error if sent before initialize succeeds.",
	},
	{
		name: "session/new",
		direction: "external-to-app",
		streamClass: "snapshot-authoritative",
		capabilityGate: "thread lifecycle",
		errorBehavior: "Pass through app-server validation errors with source metadata.",
	},
	{
		name: "session/resume",
		direction: "external-to-app",
		streamClass: "snapshot-authoritative",
		capabilityGate: "thread lifecycle",
		errorBehavior: "Return explicit resume failure; never invent missing app-server IDs.",
	},
	{
		name: "session/fork",
		direction: "external-to-app",
		streamClass: "snapshot-authoritative",
		capabilityGate: "thread lifecycle",
		errorBehavior: "Reject when source mapping is missing or app-server fork fails.",
	},
	{
		name: "session/list",
		direction: "external-to-app",
		streamClass: "snapshot-authoritative",
		capabilityGate: "thread inventory",
		errorBehavior: "Preserve app-server cursor and error payloads.",
	},
	{
		name: "session/read",
		direction: "external-to-app",
		streamClass: "snapshot-authoritative",
		capabilityGate: "thread inventory",
		errorBehavior: "Preserve app-server read errors and tombstone state.",
	},
	{
		name: "session/archive",
		direction: "external-to-app",
		streamClass: "control",
		capabilityGate: "thread lifecycle",
		errorBehavior: "Pass through archive errors and tombstone only after app-server success.",
	},
	{
		name: "session/delete",
		direction: "external-to-app",
		streamClass: "control",
		capabilityGate: "thread lifecycle",
		errorBehavior: "Pass through delete errors and tombstone only after app-server success.",
	},
	{
		name: "session/unsubscribe",
		direction: "external-to-app",
		streamClass: "control",
		capabilityGate: "thread lifecycle",
		errorBehavior: "Propagate unsubscribe failure without deleting the thread mapping.",
	},
	{
		name: "turn/start",
		direction: "external-to-app",
		streamClass: "lossless",
		capabilityGate: "turn lifecycle",
		errorBehavior: "Reject if no bound app-server thread exists.",
	},
	{
		name: "turn/steer",
		direction: "external-to-app",
		streamClass: "lossless",
		capabilityGate: "turn lifecycle",
		errorBehavior: "Preserve expected app-server turn guard errors.",
	},
	{
		name: "turn/interrupt",
		direction: "external-to-app",
		streamClass: "control",
		capabilityGate: "turn lifecycle",
		errorBehavior: "Completion is proven only by app-server turn/completed interrupted status.",
	},
	{
		name: "callback/respond",
		direction: "external-to-app",
		streamClass: "lossless",
		capabilityGate: "opaque callbacks",
		errorBehavior: "Reject unknown, duplicate, or timed-out callback IDs explicitly.",
	},
	{
		name: "callback/reject",
		direction: "external-to-app",
		streamClass: "lossless",
		capabilityGate: "opaque callbacks",
		errorBehavior: "Pass structured rejection to app-server; never auto-approve.",
	},
	{
		name: "appServer/event",
		direction: "app-to-external",
		streamClass: "lossless",
		capabilityGate: "opaque notifications",
		errorBehavior: "Connection is incompatible if opaque notifications are refused.",
	},
	{
		name: "appServer/request",
		direction: "app-to-external",
		streamClass: "lossless",
		capabilityGate: "opaque callbacks",
		errorBehavior: "Reject app-server callback if it cannot be delivered externally.",
	},
	{
		name: "appServer/response",
		direction: "app-to-external",
		streamClass: "lossless",
		capabilityGate: "opaque responses",
		errorBehavior: "Preserve original app-server JSON-RPC code, message, and data.",
	},
	{
		name: "lag",
		direction: "app-to-external",
		streamClass: "control",
		capabilityGate: "stream health",
		errorBehavior: "Emit before the next lossless event after best-effort drops.",
	},
	{
		name: "disconnect",
		direction: "app-to-external",
		streamClass: "control",
		capabilityGate: "transport health",
		errorBehavior: "Surface disconnect without claiming lost deltas were replayed.",
	},
	{
		name: "resume",
		direction: "bidirectional",
		streamClass: "snapshot-authoritative",
		capabilityGate: "resume",
		errorBehavior: "Rebuild from app-server snapshot plus new stream, or return explicit resume error.",
	},
];

export const OPAQUE_APP_SERVER_ENVELOPE_FIELDS: readonly OpaqueEnvelopeField[] = [
	{ name: "protocolVersion", required: true, description: "pi-codex-app-server protocol version." },
	{ name: "connectionId", required: true, description: "External connection correlation ID." },
	{ name: "externalSessionId", required: false, description: "External session correlation ID." },
	{ name: "externalRequestId", required: false, description: "External JSON-RPC request correlation ID." },
	{ name: "externalMessageId", required: false, description: "External message correlation ID." },
	{ name: "externalCallbackId", required: false, description: "External callback correlation ID." },
	{ name: "appThreadId", required: false, description: "Authoritative app-server thread_id." },
	{ name: "appSessionId", required: false, description: "Authoritative app-server session_id." },
	{ name: "appTurnId", required: false, description: "Authoritative app-server turn_id." },
	{ name: "appItemId", required: false, description: "Authoritative app-server item_id." },
	{ name: "appRequestId", required: false, description: "Authoritative app-server RequestId or JSON-RPC id." },
	{ name: "sequence", required: true, description: "Adapter-owned per-connection ordering sequence." },
	{ name: "streamClass", required: true, description: "Lossless, best-effort, snapshot, or control classification." },
	{ name: "capabilityFlags", required: true, description: "Negotiated capability flags that allowed this relay." },
	{ name: "originalMethod", required: true, description: "Original app-server method name." },
	{ name: "originalParams", required: true, description: "Original app-server params object." },
	{ name: "redactionClass", required: true, description: "Evidence redaction class for the original payload." },
];

export function classifyAppServerSurface(method: string): AppServerSurfaceInventoryEntry | undefined {
	const exactMatch = APP_SERVER_SURFACE_INVENTORY.find((entry) => entry.method === method);
	if (exactMatch) return exactMatch;
	if (method.startsWith("appServer/")) {
		return APP_SERVER_SURFACE_INVENTORY.find((entry) => entry.method === "appServer/futureMethod");
	}
	return undefined;
}

export function createReviewerEvidencePacketTemplate(): ReviewerEvidencePacketTemplate {
	return {
		summaryFile: "summary.md records user-facing change, before/after behavior, observed result, and residual risk.",
		commandsFile: "commands.txt records exact commands, cwd, sanitized environment choices, and exit codes.",
		inventoryDiff: "inventory-diff.json records expected vs classified app-server surfaces and must be empty.",
		cleanupReceipt:
			"cleanup-receipt.txt states: No runtime process, socket, port, tmux session, or temp dir was created by PR-001.",
		secretSafety: "No raw secret-bearing logs, auth headers, tokens, cookies, or private credentials are allowed.",
		residualRisks: "residual-risks.md maps deferred runtime behavior to the later PR that owns it.",
	};
}
