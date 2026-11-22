import { type Static } from "@sinclair/typebox";
import type { DeepReadonly } from "./readonly.ts";
/**
 * Capability-negotiation token for the typed error plane. Agents that advertise this feature accept
 * `protocol.error` frames; peers that do not keep the legacy `{ code, message }` error payloads.
 */
export declare const ERROR_FRAMES_FEATURE = "error_frames:v2";
/** Wire version of the `protocol.error` frame. Bump only together with a new negotiated feature token. */
export declare const ERROR_FRAME_VERSION = 2;
export declare const ERROR_FRAME_KIND = "protocol.error";
/**
 * Closed plane-level error vocabulary (Blueprint B, architect decision 1). Extend additively only, and
 * regenerate the conformance fixtures: `packages/protocol/test/conformance.test.ts` fails until every code owns
 * a `fixtures/protocol/error-frame-<code>.json` fixture.
 */
export declare const PROTOCOL_ERROR_CODES: readonly ["invoke_deadline", "op_failed", "budget_exceeded", "malformed_frame", "wrong_kind", "agent_busy_refresh", "persistence_failed", "machine_offline_skipped"];
export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];
/**
 * W4: every typed refusal states whether the receiver may expect redelivery. `redeliverable` never licenses an
 * unbounded retry loop; the sender is claiming durable dedup, not best-effort spam.
 */
export declare const ProtocolErrorDispositionSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"terminal">, import("@sinclair/typebox").TLiteral<"redeliverable">]>;
export type ProtocolErrorDisposition = Static<typeof ProtocolErrorDispositionSchema>;
/**
 * Payloads are strict (`additionalProperties: false`): an unknown payload field is a wire bug and must fail at
 * the boundary where it is cheapest to diagnose. The outer frame object deliberately stays lax — see
 * `ProtocolErrorFrameSchema`.
 */
export declare const ProtocolErrorPayloadSchema: import("@sinclair/typebox").TObject<{
    code: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<"agent_busy_refresh" | "budget_exceeded" | "invoke_deadline" | "machine_offline_skipped" | "malformed_frame" | "op_failed" | "persistence_failed" | "wrong_kind">[]>;
    message: import("@sinclair/typebox").TString;
    disposition: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"terminal">, import("@sinclair/typebox").TLiteral<"redeliverable">]>;
    machineId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
/**
 * First-class versioned error frame (C-PROTO-3 coordinated ruling). The envelope object is LAX BY DESIGN: older
 * hubs and agents must be able to receive a newer frame, skip it, and stay alive — that tolerance is the
 * rollback safety that makes this wire change additive. Strictness lives one level down, in the error payload.
 */
export declare const ProtocolErrorFrameSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"protocol.error">;
    /** Correlation id: echoes the recoverable id of the frame this error answers. */
    id: import("@sinclair/typebox").TString;
    v: import("@sinclair/typebox").TLiteral<2>;
    error: import("@sinclair/typebox").TObject<{
        code: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<"agent_busy_refresh" | "budget_exceeded" | "invoke_deadline" | "machine_offline_skipped" | "malformed_frame" | "op_failed" | "persistence_failed" | "wrong_kind">[]>;
        message: import("@sinclair/typebox").TString;
        disposition: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"terminal">, import("@sinclair/typebox").TLiteral<"redeliverable">]>;
        machineId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>;
}>;
export type ProtocolErrorPayload = DeepReadonly<Static<typeof ProtocolErrorPayloadSchema>>;
export type ProtocolErrorFrame = DeepReadonly<Static<typeof ProtocolErrorFrameSchema>>;
