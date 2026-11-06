import { type ProtocolErrorDisposition } from "../../protocol/src/error-plane.ts";
import { HubTransportError } from "./hub-transport-error.ts";
/**
 * Typed-error surface over the closed plane-level error vocabulary (Blueprint B, architect decision 4):
 * every upstream wire error code maps 1:1 onto an exported error class, so a caller distinguishes
 * `invoke_deadline` from `op_failed` from `budget_exceeded` via `instanceof` and `.code` instead of string
 * matching on messages. Every class extends {@link HubTransportError} (so existing catch sites keep
 * working), keeps `.code` equal to the wire code, and carries the correlated `.requestId`.
 */
export declare class MachineWireError extends HubTransportError {
    /** Whether the receiver may expect redelivery (`protocol.error` payloads only). */
    readonly disposition: ProtocolErrorDisposition | undefined;
    constructor(code: string, message: string, requestId?: string, disposition?: ProtocolErrorDisposition, detail?: unknown);
}
/** `invoke_deadline`: the deadline elapsed before the operation could start or settle. */
export declare class InvokeDeadlineError extends MachineWireError {
    constructor(message: string, requestId?: string, disposition?: ProtocolErrorDisposition);
}
/** `op_failed`: the operation raised before producing a typed result. */
export declare class OpFailedError extends MachineWireError {
    constructor(message: string, requestId?: string, disposition?: ProtocolErrorDisposition);
}
/** `budget_exceeded`: the operation exceeded its scheduled budget. */
export declare class BudgetExceededError extends MachineWireError {
    constructor(message: string, requestId?: string, disposition?: ProtocolErrorDisposition);
}
/** `malformed_frame`: the frame failed decoding at the dispatch boundary. */
export declare class MalformedFrameError extends MachineWireError {
    constructor(message: string, requestId?: string, disposition?: ProtocolErrorDisposition);
}
/** `wrong_kind`: the frame kind is not handled at this dispatch boundary. */
export declare class WrongKindError extends MachineWireError {
    constructor(message: string, requestId?: string, disposition?: ProtocolErrorDisposition);
}
/** `agent_busy_refresh`: the agent is refreshing credentials; the delivery may be retried. */
export declare class AgentBusyRefreshError extends MachineWireError {
    constructor(message: string, requestId?: string, disposition?: ProtocolErrorDisposition);
}
/** `persistence_failed`: a durable journal write failed; no success was recorded. */
export declare class PersistenceFailedError extends MachineWireError {
    constructor(message: string, requestId?: string, disposition?: ProtocolErrorDisposition);
}
/** `machine_offline_skipped`: the machine was offline when the fanout ran; skipped. */
export declare class MachineOfflineSkippedError extends MachineWireError {
    constructor(message: string, requestId?: string, disposition?: ProtocolErrorDisposition);
}
/** Reject with the 1:1 mapped class when `code` belongs to the closed protocol vocabulary; anything else
 *  (hub-internal codes like `machine_unavailable`) stays a plain {@link HubTransportError}. */
export declare const machineErrorForCode: (code: string, message: string, requestId?: string, disposition?: ProtocolErrorDisposition) => HubTransportError;
