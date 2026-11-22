/**
 * A correlated hub/machine failure surfaced to an invoke caller. `code` is the hub.error code
 * (`machine_unavailable` / `duplicate_request_id` / `machine_send_failed`) or a client-side code
 * (`timeout` / `machine_error` / `not_connected` / `closed` / `directory_failed`).
 *
 * Lives in its own module (not ws-transport.ts) so the typed-error classes in machine-errors.ts can extend
 * it without an import cycle across the transport/pending-invocations/machine-errors edge.
 */
export declare class HubTransportError extends Error {
    readonly code: string;
    readonly requestId: string;
    readonly detail: unknown;
    /** Some terminal failures acknowledge accepted input alongside the error. Never discard that result. */
    readonly result: unknown;
    constructor(code: string, message: string, requestId?: string, detail?: unknown, result?: unknown);
}
/** Internal signal: the lifecycle wait's own observation budget expired, not a hub/network failure. */
export declare class TerminalWaitDeadlineError extends HubTransportError {
}
