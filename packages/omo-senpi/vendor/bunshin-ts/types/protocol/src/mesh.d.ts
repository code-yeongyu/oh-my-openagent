import { type Static } from "@sinclair/typebox";
import { ArtifactRefSchema } from "./capability.ts";
import type { DeepReadonly } from "./readonly.ts";
export declare const meshSchemaId: (name: string) => string;
export declare const AGENT_MAX_YIELD_MS = 10000;
export declare const HUB_PENDING_RESPONSE_TIMEOUT_MS = 30000;
/** Default deadline for a non-durable invoke. */
export declare const SDK_MAX_DEADLINE_MS = 30000;
export declare const DURABLE_INVOKE_INFLIGHT_RETENTION_MS = 120000;
/** How long a terminal durable result outlives max(requester deadline, completion). The SDK only resumes a lost
 *  result via /results until the request's own deadline, so a longer retention only keeps payloads at rest (#228). */
export declare const DURABLE_INVOKE_RESULT_RETENTION_MS = 120000;
export declare const DURABLE_INVOKE_INLINE_MAX_BYTES = 65536;
export declare const DURABLE_RESULT_ENVELOPE_FEATURE = "durable-result-envelope-v1";
export declare const LONG_SHELL_BUDGET_MS = 3600000;
export declare const DURABLE_INVOKE_MAX_BUDGET_MS = 3660000;
export declare const HEARTBEAT_MS = 30000;
export declare const PONG_TIMEOUT_MS = 10000;
export declare const ARTIFACT_OFFLOAD_THRESHOLD_BYTES = 1048576;
export declare const TERMINAL_YIELD_MIN_MS = 250;
export declare const TERMINAL_MAX_YIELD_MS = 10000;
export declare const TRANSFER_CANDIDATE_TTL_MS = 90000;
export declare const TRANSFER_TICKET_TTL_MS = 60000;
export declare const TRANSFER_PROBE_TIMEOUT_MS = 500;
export declare const TRANSFER_MAX_STREAM_MS = 900000;
export declare const TRANSFER_IDLE_TIMEOUT_MS = 30000;
export declare const TRANSFER_REDEEM_TIMEOUT_MS = 5000;
export declare const TREE_TRANSFER_BUDGET_MS = 600000;
export declare const TREE_ARCHIVE_MAX_BYTES = 268435456;
export declare const TREE_ARCHIVE_FORMATS: readonly ["tar+gzip"];
export declare const PROTOCOL_FEATURES: readonly ["durable-invoke-v1", "artifact-write", "transfer-ticket", "network-report", "transfer-probe", "protocol-rev-2", "error_frames:v2", "durable-result-envelope-v1", "terminal-lifecycle:v1", "machine-key-refresh:v1", "agent-health:v1", "fleet-events:v1", "ssh-bridge:v1"];
export declare const DurableResultEnvelopeSchema: import("@sinclair/typebox").TObject<{
    bodyArtifact: import("@sinclair/typebox").TObject<{
        envelope: import("@sinclair/typebox").TLiteral<"durable-result-envelope-v1">;
        kind: import("@sinclair/typebox").TLiteral<"artifact">;
        sha256: import("@sinclair/typebox").TString;
        size: import("@sinclair/typebox").TInteger;
        url: import("@sinclair/typebox").TString;
    }>;
}>;
export type DurableResultEnvelope = DeepReadonly<Static<typeof DurableResultEnvelopeSchema>>;
export declare const durableResultEnvelope: (bodyArtifact: Static<typeof ArtifactRefSchema>) => DurableResultEnvelope;
export declare const integer: import("@sinclair/typebox").TInteger;
declare const terminalResult: import("@sinclair/typebox").TObject<{
    handleId: import("@sinclair/typebox").TString;
    output: import("@sinclair/typebox").TString;
    state: import("@sinclair/typebox").TString;
    lifecycle: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        state: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"starting">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"waiting_input">]>;
        stdinOpen: import("@sinclair/typebox").TBoolean;
        outputClosed: import("@sinclair/typebox").TBoolean;
    }>, import("@sinclair/typebox").TObject<{
        state: import("@sinclair/typebox").TLiteral<"exited">;
        exitCode: import("@sinclair/typebox").TInteger;
        stdinOpen: import("@sinclair/typebox").TLiteral<false>;
        outputClosed: import("@sinclair/typebox").TBoolean;
    }>, import("@sinclair/typebox").TObject<{
        state: import("@sinclair/typebox").TLiteral<"killed">;
        stdinOpen: import("@sinclair/typebox").TLiteral<false>;
        outputClosed: import("@sinclair/typebox").TBoolean;
    }>, import("@sinclair/typebox").TObject<{
        state: import("@sinclair/typebox").TLiteral<"lost">;
        reason: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"unknown_handle">, import("@sinclair/typebox").TLiteral<"agent_restarted">, import("@sinclair/typebox").TLiteral<"exit_status_unavailable">]>;
        stdinOpen: import("@sinclair/typebox").TLiteral<false>;
        outputClosed: import("@sinclair/typebox").TBoolean;
    }>]>>;
    stdinEffect: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        acceptedBytes: import("@sinclair/typebox").TInteger;
        observed: import("@sinclair/typebox").TBoolean;
    }>>;
    lastSeq: import("@sinclair/typebox").TInteger;
    truncated: import("@sinclair/typebox").TBoolean;
    omittedBytes: import("@sinclair/typebox").TInteger;
    totalBytes: import("@sinclair/typebox").TInteger;
    exitCode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    startedAtMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    elapsedMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
}>;
export declare const TreeApplyRequestSchema: import("@sinclair/typebox").TObject<{
    path: import("@sinclair/typebox").TString;
    artifact: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"artifact">;
        sha256: import("@sinclair/typebox").TString;
        size: import("@sinclair/typebox").TInteger;
        url: import("@sinclair/typebox").TString;
    }>;
    format: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<"tar+gzip">[]>;
    clean: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    sourceMachineId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    ticket: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
/** Terminal hub op-ledger refusal: the effect completed, but its result body is no longer stored. */
export declare const OP_ALREADY_COMPLETED_ERROR_CODE = "op_already_completed";
export declare const ErrorPayloadSchema: import("@sinclair/typebox").TObject<{
    code: import("@sinclair/typebox").TString;
    message: import("@sinclair/typebox").TString;
}>;
export declare const BridgePolicySchema: import("@sinclair/typebox").TObject<{
    enabled: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    sources: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"ssh_config">, import("@sinclair/typebox").TLiteral<"tailscale">, import("@sinclair/typebox").TLiteral<"manual">]>>>;
    targets: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        target: import("@sinclair/typebox").TString;
        enabled: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
        hostKeyFp: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
        home: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>>>;
}>;
export declare const BridgeRouteSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"auto">, import("@sinclair/typebox").TLiteral<"direct">, import("@sinclair/typebox").TLiteral<"bridge">, import("@sinclair/typebox").TObject<{
    via: import("@sinclair/typebox").TString;
    target: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>]>;
export type BridgePolicy = DeepReadonly<Static<typeof BridgePolicySchema>>;
export type BridgeRoute = DeepReadonly<Static<typeof BridgeRouteSchema>>;
export declare const meshOperationContracts: {
    readonly echo: readonly [import("@sinclair/typebox").TUnknown, import("@sinclair/typebox").TUnknown];
    readonly shell: readonly [import("@sinclair/typebox").TObject<{
        command: import("@sinclair/typebox").TString;
        cwd: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        env: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TString>>;
        timeoutMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>, import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
        exitCode: import("@sinclair/typebox").TInteger;
        stdout: import("@sinclair/typebox").TString;
        stderr: import("@sinclair/typebox").TString;
        signal: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        timeout: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"deadline">, import("@sinclair/typebox").TLiteral<"exit-unconfirmed">]>>;
        startedAtMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        durationMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>, import("@sinclair/typebox").TObject<{
        spillPath: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        totalBytes: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        omittedBytes: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        head: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>]>];
    readonly exec: readonly [import("@sinclair/typebox").TObject<{
        command: import("@sinclair/typebox").TString;
        cwd: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        env: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TString>>;
        timeoutMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>, import("@sinclair/typebox").TObject<{
        stdout: import("@sinclair/typebox").TString;
        stderr: import("@sinclair/typebox").TString;
        spillPath: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        totalBytes: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        omittedBytes: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        head: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TLiteral<"exited">;
            exitCode: import("@sinclair/typebox").TInteger;
        }>, import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TLiteral<"timed_out">;
        }>]>;
        durationMs: import("@sinclair/typebox").TInteger;
        cwd: import("@sinclair/typebox").TString;
    }>];
    readonly terminalExec: readonly [import("@sinclair/typebox").TObject<{
        cmd: import("@sinclair/typebox").TString;
        workdir: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        yield_ms: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
    }>, import("@sinclair/typebox").TObject<{
        handleId: import("@sinclair/typebox").TString;
        output: import("@sinclair/typebox").TString;
        state: import("@sinclair/typebox").TString;
        lifecycle: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"starting">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"waiting_input">]>;
            stdinOpen: import("@sinclair/typebox").TBoolean;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>, import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TLiteral<"exited">;
            exitCode: import("@sinclair/typebox").TInteger;
            stdinOpen: import("@sinclair/typebox").TLiteral<false>;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>, import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TLiteral<"killed">;
            stdinOpen: import("@sinclair/typebox").TLiteral<false>;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>, import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TLiteral<"lost">;
            reason: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"unknown_handle">, import("@sinclair/typebox").TLiteral<"agent_restarted">, import("@sinclair/typebox").TLiteral<"exit_status_unavailable">]>;
            stdinOpen: import("@sinclair/typebox").TLiteral<false>;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>]>>;
        stdinEffect: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
            acceptedBytes: import("@sinclair/typebox").TInteger;
            observed: import("@sinclair/typebox").TBoolean;
        }>>;
        lastSeq: import("@sinclair/typebox").TInteger;
        truncated: import("@sinclair/typebox").TBoolean;
        omittedBytes: import("@sinclair/typebox").TInteger;
        totalBytes: import("@sinclair/typebox").TInteger;
        exitCode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        startedAtMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        elapsedMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>];
    readonly terminalWrite: readonly [import("@sinclair/typebox").TObject<{
        handle_id: import("@sinclair/typebox").TString;
        yield_ms: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        last_seq: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        data: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
        expectActivityMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>, import("@sinclair/typebox").TObject<{
        handleId: import("@sinclair/typebox").TString;
        output: import("@sinclair/typebox").TString;
        state: import("@sinclair/typebox").TString;
        lifecycle: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"starting">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"waiting_input">]>;
            stdinOpen: import("@sinclair/typebox").TBoolean;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>, import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TLiteral<"exited">;
            exitCode: import("@sinclair/typebox").TInteger;
            stdinOpen: import("@sinclair/typebox").TLiteral<false>;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>, import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TLiteral<"killed">;
            stdinOpen: import("@sinclair/typebox").TLiteral<false>;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>, import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TLiteral<"lost">;
            reason: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"unknown_handle">, import("@sinclair/typebox").TLiteral<"agent_restarted">, import("@sinclair/typebox").TLiteral<"exit_status_unavailable">]>;
            stdinOpen: import("@sinclair/typebox").TLiteral<false>;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>]>>;
        stdinEffect: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
            acceptedBytes: import("@sinclair/typebox").TInteger;
            observed: import("@sinclair/typebox").TBoolean;
        }>>;
        lastSeq: import("@sinclair/typebox").TInteger;
        truncated: import("@sinclair/typebox").TBoolean;
        omittedBytes: import("@sinclair/typebox").TInteger;
        totalBytes: import("@sinclair/typebox").TInteger;
        exitCode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        startedAtMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        elapsedMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>];
    readonly terminalWait: readonly [import("@sinclair/typebox").TObject<{
        handle_id: import("@sinclair/typebox").TString;
        yield_ms: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        last_seq: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
        until: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"starting">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"waiting_input">, import("@sinclair/typebox").TLiteral<"exited">, import("@sinclair/typebox").TLiteral<"killed">, import("@sinclair/typebox").TLiteral<"lost">]>>>;
    }>, import("@sinclair/typebox").TObject<{
        handleId: import("@sinclair/typebox").TString;
        output: import("@sinclair/typebox").TString;
        state: import("@sinclair/typebox").TString;
        lifecycle: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"starting">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"waiting_input">]>;
            stdinOpen: import("@sinclair/typebox").TBoolean;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>, import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TLiteral<"exited">;
            exitCode: import("@sinclair/typebox").TInteger;
            stdinOpen: import("@sinclair/typebox").TLiteral<false>;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>, import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TLiteral<"killed">;
            stdinOpen: import("@sinclair/typebox").TLiteral<false>;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>, import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TLiteral<"lost">;
            reason: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"unknown_handle">, import("@sinclair/typebox").TLiteral<"agent_restarted">, import("@sinclair/typebox").TLiteral<"exit_status_unavailable">]>;
            stdinOpen: import("@sinclair/typebox").TLiteral<false>;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>]>>;
        stdinEffect: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
            acceptedBytes: import("@sinclair/typebox").TInteger;
            observed: import("@sinclair/typebox").TBoolean;
        }>>;
        lastSeq: import("@sinclair/typebox").TInteger;
        truncated: import("@sinclair/typebox").TBoolean;
        omittedBytes: import("@sinclair/typebox").TInteger;
        totalBytes: import("@sinclair/typebox").TInteger;
        exitCode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        startedAtMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        elapsedMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>];
    readonly terminalKill: readonly [import("@sinclair/typebox").TObject<{
        handle_id: import("@sinclair/typebox").TString;
        lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
    }>, import("@sinclair/typebox").TObject<{
        handleId: import("@sinclair/typebox").TString;
        state: import("@sinclair/typebox").TLiteral<"task-failed">;
        lifecycle: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"starting">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"waiting_input">]>;
            stdinOpen: import("@sinclair/typebox").TBoolean;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>, import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TLiteral<"exited">;
            exitCode: import("@sinclair/typebox").TInteger;
            stdinOpen: import("@sinclair/typebox").TLiteral<false>;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>, import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TLiteral<"killed">;
            stdinOpen: import("@sinclair/typebox").TLiteral<false>;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>, import("@sinclair/typebox").TObject<{
            state: import("@sinclair/typebox").TLiteral<"lost">;
            reason: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"unknown_handle">, import("@sinclair/typebox").TLiteral<"agent_restarted">, import("@sinclair/typebox").TLiteral<"exit_status_unavailable">]>;
            stdinOpen: import("@sinclair/typebox").TLiteral<false>;
            outputClosed: import("@sinclair/typebox").TBoolean;
        }>]>>;
        reason: import("@sinclair/typebox").TLiteral<"killed">;
    }>];
    readonly fsRead: readonly [import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
        limit_bytes: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        offload: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"auto">, import("@sinclair/typebox").TLiteral<"never">]>>;
    }>, import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
        sizeBytes: import("@sinclair/typebox").TInteger;
        readonly: import("@sinclair/typebox").TBoolean;
        truncated: import("@sinclair/typebox").TBoolean;
        bytes: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TLiteral<"full">;
            base64: import("@sinclair/typebox").TString;
        }>, import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TLiteral<"truncated">;
            head: import("@sinclair/typebox").TString;
            tail: import("@sinclair/typebox").TString;
        }>]>;
    }>, import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"artifact">;
        sha256: import("@sinclair/typebox").TString;
        size: import("@sinclair/typebox").TInteger;
        url: import("@sinclair/typebox").TString;
    }>]>];
    readonly fsWrite: readonly [import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
        bytes: import("@sinclair/typebox").TString;
        create_parent_dirs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    }>, import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
        artifact: import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TLiteral<"artifact">;
            sha256: import("@sinclair/typebox").TString;
            size: import("@sinclair/typebox").TInteger;
            url: import("@sinclair/typebox").TString;
        }>;
        create_parent_dirs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
        sourceMachineId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        ticket: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>]>, import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
        bytesWritten: import("@sinclair/typebox").TInteger;
    }>];
    readonly fsTreePack: readonly [import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
        include: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
        ignore: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
        format: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<"tar+gzip">[]>;
        maxBytes: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>, import("@sinclair/typebox").TObject<{
        artifact: import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TLiteral<"artifact">;
            sha256: import("@sinclair/typebox").TString;
            size: import("@sinclair/typebox").TInteger;
            url: import("@sinclair/typebox").TString;
        }>;
        fileCount: import("@sinclair/typebox").TInteger;
        dirCount: import("@sinclair/typebox").TInteger;
        symlinkCount: import("@sinclair/typebox").TInteger;
        totalBytes: import("@sinclair/typebox").TInteger;
        archiveBytes: import("@sinclair/typebox").TInteger;
    }>];
    readonly fsTreeApply: readonly [import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
        artifact: import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TLiteral<"artifact">;
            sha256: import("@sinclair/typebox").TString;
            size: import("@sinclair/typebox").TInteger;
            url: import("@sinclair/typebox").TString;
        }>;
        format: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<"tar+gzip">[]>;
        clean: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
        sourceMachineId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        ticket: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>, import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
        fileCount: import("@sinclair/typebox").TInteger;
        writtenBytes: import("@sinclair/typebox").TInteger;
    }>];
    readonly fsStat: readonly [import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
    }>, import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
        kind: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<string>[]>;
        sizeBytes: import("@sinclair/typebox").TInteger;
        readonly: import("@sinclair/typebox").TBoolean;
    }>];
    readonly fsList: readonly [import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
        limit: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>, import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
        entries: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            name: import("@sinclair/typebox").TString;
            path: import("@sinclair/typebox").TString;
            kind: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<string>[]>;
            sizeBytes: import("@sinclair/typebox").TInteger;
            readonly: import("@sinclair/typebox").TBoolean;
        }>>;
        truncated: import("@sinclair/typebox").TBoolean;
    }>];
    readonly fsGlob: readonly [import("@sinclair/typebox").TObject<{
        pattern: import("@sinclair/typebox").TString;
        limit: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>, import("@sinclair/typebox").TObject<{
        pattern: import("@sinclair/typebox").TString;
        matches: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
        truncated: import("@sinclair/typebox").TBoolean;
    }>];
    readonly fsGrep: readonly [import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
        pattern: import("@sinclair/typebox").TString;
        limit: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>, import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
        matches: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            path: import("@sinclair/typebox").TString;
            byteOffset: import("@sinclair/typebox").TInteger;
            snippet: import("@sinclair/typebox").TString;
            utf8Lossy: import("@sinclair/typebox").TBoolean;
        }>>;
        truncated: import("@sinclair/typebox").TBoolean;
    }>];
    readonly doctor: readonly [import("@sinclair/typebox").TObject<{
        transferPairs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            sourceMachineId: import("@sinclair/typebox").TString;
            destinationMachineId: import("@sinclair/typebox").TString;
        }>>>;
    }>, import("@sinclair/typebox").TObject<{
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"ok">, import("@sinclair/typebox").TLiteral<"warn">, import("@sinclair/typebox").TLiteral<"error">]>;
        os: import("@sinclair/typebox").TString;
        arch: import("@sinclair/typebox").TString;
        kernel: import("@sinclair/typebox").TString;
        shell: import("@sinclair/typebox").TString;
        gitBash: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        sandboxAvailable: import("@sinclair/typebox").TBoolean;
        capabilities: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
        cpu: import("@sinclair/typebox").TObject<{
            cores: import("@sinclair/typebox").TInteger;
            model: import("@sinclair/typebox").TString;
        }>;
        memTotal: import("@sinclair/typebox").TInteger;
        memFree: import("@sinclair/typebox").TInteger;
        load: import("@sinclair/typebox").TTuple<[import("@sinclair/typebox").TNumber, import("@sinclair/typebox").TNumber, import("@sinclair/typebox").TNumber]>;
        disk: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            mount: import("@sinclair/typebox").TString;
            total: import("@sinclair/typebox").TInteger;
            free: import("@sinclair/typebox").TInteger;
        }>>;
        netIfaces: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            name: import("@sinclair/typebox").TString;
            addresses: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
        }>>;
        permissions: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            name: import("@sinclair/typebox").TString;
            granted: import("@sinclair/typebox").TBoolean;
            details: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        }>>;
        network: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
            outboundInternet: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
                status: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"reachable">, import("@sinclair/typebox").TLiteral<"unreachable">, import("@sinclair/typebox").TLiteral<"unknown">]>>;
                target: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
                roundTripMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
                checkedAtMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
                errorCode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
                details: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            }>>;
            externallyObservedAddress: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
                address: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
                family: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"ipv4">, import("@sinclair/typebox").TLiteral<"ipv6">]>>;
                port: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
                observedAtMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
            }>>;
            hub: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
                status: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"reachable">, import("@sinclair/typebox").TLiteral<"unreachable">, import("@sinclair/typebox").TLiteral<"unknown">]>>;
                target: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
                roundTripMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
                checkedAtMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
                errorCode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
                details: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            }>>;
            artifactStore: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
                status: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"reachable">, import("@sinclair/typebox").TLiteral<"unreachable">, import("@sinclair/typebox").TLiteral<"unknown">]>>;
                brokerRoundTripMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
                putReachable: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
                getReachable: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
                checkedAtMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
                errorCode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
                details: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            }>>;
            transferPairs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
                sourceMachineId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
                destinationMachineId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
                tier: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"tailnet_direct">, import("@sinclair/typebox").TLiteral<"public_direct">, import("@sinclair/typebox").TLiteral<"artifact_store">, import("@sinclair/typebox").TLiteral<"unavailable">]>>;
                candidateId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
                roundTripMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
                checkedAtMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
                reasonCode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
                details: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            }>>>;
        }>>;
    }>];
    readonly service: readonly [import("@sinclair/typebox").TObject<{
        name: import("@sinclair/typebox").TString;
    }>, import("@sinclair/typebox").TObject<{
        ok: import("@sinclair/typebox").TLiteral<true>;
        service: import("@sinclair/typebox").TString;
        restarted: import("@sinclair/typebox").TLiteral<true>;
    }>];
    readonly release: readonly [import("@sinclair/typebox").TObject<{
        deployRoot: import("@sinclair/typebox").TString;
        files: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            path: import("@sinclair/typebox").TString;
            contentsBase64: import("@sinclair/typebox").TString;
        }>>;
        healthCheck: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
            command: import("@sinclair/typebox").TString;
            timeoutMs: import("@sinclair/typebox").TInteger;
        }>>;
        retention: import("@sinclair/typebox").TInteger;
    }>, import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        status: import("@sinclair/typebox").TLiteral<"promoted">;
        sha: import("@sinclair/typebox").TString;
        previous: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        pruned: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    }>, import("@sinclair/typebox").TObject<{
        status: import("@sinclair/typebox").TLiteral<"rolled_back">;
        attemptedSha: import("@sinclair/typebox").TString;
        restored: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        reason: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TLiteral<"health_check_failed">;
            exitCode: import("@sinclair/typebox").TInteger;
        }>, import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TLiteral<"health_check_timed_out">;
        }>]>;
    }>]>];
    readonly manifest: readonly [import("@sinclair/typebox").TObject<{
        machineId: import("@sinclair/typebox").TString;
        protocolVersion: import("@sinclair/typebox").TLiteral<"0.0.0">;
        protocolFeatures: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
        build: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
            version: import("@sinclair/typebox").TString;
            binarySha256: import("@sinclair/typebox").TString;
            onDiskSha256: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            installPath: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        }>>;
        host: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
            load1: import("@sinclair/typebox").TNumber;
            cores: import("@sinclair/typebox").TInteger;
        }>>;
        bridge: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
            enabled: import("@sinclair/typebox").TBoolean;
            sources: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"ssh_config">, import("@sinclair/typebox").TLiteral<"tailscale">, import("@sinclair/typebox").TLiteral<"manual">]>>;
            targets: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
                target: import("@sinclair/typebox").TString;
                discovered: import("@sinclair/typebox").TBoolean;
                addresses: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
                    host: import("@sinclair/typebox").TString;
                    port: import("@sinclair/typebox").TInteger;
                    user: import("@sinclair/typebox").TString;
                }>>;
                hostKeyFp: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
                probe: import("@sinclair/typebox").TObject<{
                    state: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"unknown">, import("@sinclair/typebox").TLiteral<"reachable">, import("@sinclair/typebox").TLiteral<"unreachable">, import("@sinclair/typebox").TLiteral<"attention">, import("@sinclair/typebox").TLiteral<"disabled">]>;
                    rttMs: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TInteger, import("@sinclair/typebox").TNull]>;
                    at: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TInteger, import("@sinclair/typebox").TNull]>;
                    reason: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"bridge_disabled">, import("@sinclair/typebox").TLiteral<"bridge_target_unknown">, import("@sinclair/typebox").TLiteral<"bridge_target_unreachable">, import("@sinclair/typebox").TLiteral<"bridge_auth_denied">, import("@sinclair/typebox").TLiteral<"bridge_hostkey_mismatch">, import("@sinclair/typebox").TLiteral<"bridge_tier_unsupported">, import("@sinclair/typebox").TLiteral<"bridge_cycle">, import("@sinclair/typebox").TLiteral<"bridge_timeout">]>, import("@sinclair/typebox").TLiteral<"hostkey_unpinned">, import("@sinclair/typebox").TLiteral<"protocol_mismatch">, import("@sinclair/typebox").TLiteral<"probe_budget_exhausted">, import("@sinclair/typebox").TLiteral<"identity_conflict">, import("@sinclair/typebox").TNull]>;
                }>;
                tier: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<0>, import("@sinclair/typebox").TLiteral<1>]>, import("@sinclair/typebox").TNull]>;
            }>>;
        }>>;
        sshHostKeyFingerprints: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
        capabilities: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            name: import("@sinclair/typebox").TString;
            version: import("@sinclair/typebox").TString;
            transport: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"built-in">, import("@sinclair/typebox").TLiteral<"sidecar">, import("@sinclair/typebox").TLiteral<"native">]>;
            ops: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
            description: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            schema: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnknown>>;
            schemas: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnknown>>>;
        }>>;
        effects: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"read">, import("@sinclair/typebox").TLiteral<"mutate">]>>>;
    }>, import("@sinclair/typebox").TObject<{
        ok: import("@sinclair/typebox").TLiteral<true>;
    }>];
    readonly artifactPut: readonly [import("@sinclair/typebox").TObject<{
        sha256: import("@sinclair/typebox").TString;
        size: import("@sinclair/typebox").TInteger;
    }>, import("@sinclair/typebox").TObject<{
        uploadUrl: import("@sinclair/typebox").TString;
        sha256: import("@sinclair/typebox").TString;
    }>];
    readonly artifactGet: readonly [import("@sinclair/typebox").TObject<{
        sha256: import("@sinclair/typebox").TString;
    }>, import("@sinclair/typebox").TObject<{
        downloadUrl: import("@sinclair/typebox").TString;
        sha256: import("@sinclair/typebox").TString;
    }>];
    readonly artifactTransferTicket: readonly [import("@sinclair/typebox").TObject<{
        sourceMachineId: import("@sinclair/typebox").TString;
        destinationMachineId: import("@sinclair/typebox").TString;
        sha256: import("@sinclair/typebox").TString;
        size: import("@sinclair/typebox").TInteger;
        offset: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>, import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        route: import("@sinclair/typebox").TLiteral<"direct">;
        transferId: import("@sinclair/typebox").TString;
        ticket: import("@sinclair/typebox").TString;
        expiresAtMs: import("@sinclair/typebox").TInteger;
        sha256: import("@sinclair/typebox").TString;
        size: import("@sinclair/typebox").TInteger;
        offset: import("@sinclair/typebox").TInteger;
        candidates: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            readonly candidateId: import("@sinclair/typebox").TString;
            readonly tier: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"tailnet_direct">, import("@sinclair/typebox").TLiteral<"public_direct">]>;
            readonly url: import("@sinclair/typebox").TString;
            readonly tlsSpkiSha256: import("@sinclair/typebox").TString;
        }>>;
        fallback: import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TLiteral<"artifact">;
            sha256: import("@sinclair/typebox").TString;
            size: import("@sinclair/typebox").TInteger;
            url: import("@sinclair/typebox").TString;
        }>;
    }>, import("@sinclair/typebox").TObject<{
        route: import("@sinclair/typebox").TLiteral<"artifact_store">;
        transferId: import("@sinclair/typebox").TString;
        expiresAtMs: import("@sinclair/typebox").TInteger;
        sha256: import("@sinclair/typebox").TString;
        size: import("@sinclair/typebox").TInteger;
        offset: import("@sinclair/typebox").TInteger;
        fallback: import("@sinclair/typebox").TObject<{
            kind: import("@sinclair/typebox").TLiteral<"artifact">;
            sha256: import("@sinclair/typebox").TString;
            size: import("@sinclair/typebox").TInteger;
            url: import("@sinclair/typebox").TString;
        }>;
    }>]>];
    readonly agentRestart: readonly [import("@sinclair/typebox").TObject<{
        reason: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>, import("@sinclair/typebox").TObject<{
        scheduledInMs: import("@sinclair/typebox").TInteger;
        pid: import("@sinclair/typebox").TInteger;
    }>];
    readonly processInfo: readonly [import("@sinclair/typebox").TObject<{
        pid: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        handleId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>, import("@sinclair/typebox").TObject<{
        pid: import("@sinclair/typebox").TInteger;
        startedAtMs: import("@sinclair/typebox").TInteger;
        cpuTimeMs: import("@sinclair/typebox").TInteger;
        rssBytes: import("@sinclair/typebox").TInteger;
        command: import("@sinclair/typebox").TString;
        lastOpAtMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>];
    readonly meshMessage: readonly [import("@sinclair/typebox").TObject<{
        topic: import("@sinclair/typebox").TString;
        body: import("@sinclair/typebox").TUnknown;
    }>, import("@sinclair/typebox").TObject<{
        accepted: import("@sinclair/typebox").TLiteral<true>;
        seq: import("@sinclair/typebox").TInteger;
        inboxPath: import("@sinclair/typebox").TString;
    }>];
    readonly bridgeList: readonly [import("@sinclair/typebox").TObject<{}>, import("@sinclair/typebox").TObject<{
        enabled: import("@sinclair/typebox").TBoolean;
        sources: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"ssh_config">, import("@sinclair/typebox").TLiteral<"tailscale">, import("@sinclair/typebox").TLiteral<"manual">]>>;
        targets: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            target: import("@sinclair/typebox").TString;
            discovered: import("@sinclair/typebox").TBoolean;
            addresses: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
                host: import("@sinclair/typebox").TString;
                port: import("@sinclair/typebox").TInteger;
                user: import("@sinclair/typebox").TString;
            }>>;
            hostKeyFp: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
            probe: import("@sinclair/typebox").TObject<{
                state: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"unknown">, import("@sinclair/typebox").TLiteral<"reachable">, import("@sinclair/typebox").TLiteral<"unreachable">, import("@sinclair/typebox").TLiteral<"attention">, import("@sinclair/typebox").TLiteral<"disabled">]>;
                rttMs: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TInteger, import("@sinclair/typebox").TNull]>;
                at: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TInteger, import("@sinclair/typebox").TNull]>;
                reason: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"bridge_disabled">, import("@sinclair/typebox").TLiteral<"bridge_target_unknown">, import("@sinclair/typebox").TLiteral<"bridge_target_unreachable">, import("@sinclair/typebox").TLiteral<"bridge_auth_denied">, import("@sinclair/typebox").TLiteral<"bridge_hostkey_mismatch">, import("@sinclair/typebox").TLiteral<"bridge_tier_unsupported">, import("@sinclair/typebox").TLiteral<"bridge_cycle">, import("@sinclair/typebox").TLiteral<"bridge_timeout">]>, import("@sinclair/typebox").TLiteral<"hostkey_unpinned">, import("@sinclair/typebox").TLiteral<"protocol_mismatch">, import("@sinclair/typebox").TLiteral<"probe_budget_exhausted">, import("@sinclair/typebox").TLiteral<"identity_conflict">, import("@sinclair/typebox").TNull]>;
            }>;
            tier: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<0>, import("@sinclair/typebox").TLiteral<1>]>, import("@sinclair/typebox").TNull]>;
        }>>;
        truncated: import("@sinclair/typebox").TBoolean;
    }>];
    readonly bridgeProbe: readonly [import("@sinclair/typebox").TObject<{
        targets: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    }>, import("@sinclair/typebox").TObject<{
        results: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            target: import("@sinclair/typebox").TString;
            discovered: import("@sinclair/typebox").TBoolean;
            addresses: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
                host: import("@sinclair/typebox").TString;
                port: import("@sinclair/typebox").TInteger;
                user: import("@sinclair/typebox").TString;
            }>>;
            hostKeyFp: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
            probe: import("@sinclair/typebox").TObject<{
                state: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"unknown">, import("@sinclair/typebox").TLiteral<"reachable">, import("@sinclair/typebox").TLiteral<"unreachable">, import("@sinclair/typebox").TLiteral<"attention">, import("@sinclair/typebox").TLiteral<"disabled">]>;
                rttMs: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TInteger, import("@sinclair/typebox").TNull]>;
                at: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TInteger, import("@sinclair/typebox").TNull]>;
                reason: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"bridge_disabled">, import("@sinclair/typebox").TLiteral<"bridge_target_unknown">, import("@sinclair/typebox").TLiteral<"bridge_target_unreachable">, import("@sinclair/typebox").TLiteral<"bridge_auth_denied">, import("@sinclair/typebox").TLiteral<"bridge_hostkey_mismatch">, import("@sinclair/typebox").TLiteral<"bridge_tier_unsupported">, import("@sinclair/typebox").TLiteral<"bridge_cycle">, import("@sinclair/typebox").TLiteral<"bridge_timeout">]>, import("@sinclair/typebox").TLiteral<"hostkey_unpinned">, import("@sinclair/typebox").TLiteral<"protocol_mismatch">, import("@sinclair/typebox").TLiteral<"probe_budget_exhausted">, import("@sinclair/typebox").TLiteral<"identity_conflict">, import("@sinclair/typebox").TNull]>;
            }>;
            tier: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<0>, import("@sinclair/typebox").TLiteral<1>]>, import("@sinclair/typebox").TNull]>;
            observedHostKeyFp: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
        }>>;
        at: import("@sinclair/typebox").TInteger;
    }>];
    readonly bridgeInvoke: readonly [import("@sinclair/typebox").TObject<{
        target: import("@sinclair/typebox").TString;
        op: import("@sinclair/typebox").TString;
        args: import("@sinclair/typebox").TUnknown;
        tier: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<0>, import("@sinclair/typebox").TLiteral<1>]>>;
    }>, import("@sinclair/typebox").TObject<{
        via: import("@sinclair/typebox").TString;
        target: import("@sinclair/typebox").TString;
        hostKeyFp: import("@sinclair/typebox").TString;
        tier: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<0>, import("@sinclair/typebox").TLiteral<1>]>;
        response: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
            result: import("@sinclair/typebox").TUnknown;
        }>, import("@sinclair/typebox").TObject<{
            error: import("@sinclair/typebox").TObject<{
                code: import("@sinclair/typebox").TString;
                message: import("@sinclair/typebox").TString;
            }>;
        }>]>;
    }>];
    readonly artifactTransferServe: readonly [import("@sinclair/typebox").TObject<{
        readonly transferId: import("@sinclair/typebox").TString;
        readonly sha256: import("@sinclair/typebox").TString;
        readonly size: import("@sinclair/typebox").TInteger;
        readonly offset: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        readonly expiresAtMs: import("@sinclair/typebox").TInteger;
    }>, import("@sinclair/typebox").TObject<{
        readonly transferId: import("@sinclair/typebox").TString;
        readonly listenerPort: import("@sinclair/typebox").TInteger;
        readonly tlsSpkiSha256: import("@sinclair/typebox").TString;
        readonly expiresAtMs: import("@sinclair/typebox").TInteger;
        readonly addresses: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    }>];
};
export declare const MeshInvokeProvenanceSchema: import("@sinclair/typebox").TObject<{
    requesterSession: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    hubReceivedAtMs: import("@sinclair/typebox").TInteger;
    claimedFromMachineId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
export type MeshInvokeProvenance = DeepReadonly<Static<typeof MeshInvokeProvenanceSchema>>;
export declare const MeshTransferRedeemSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"machine.transfer.redeem">;
    id: import("@sinclair/typebox").TString;
    ticketId: import("@sinclair/typebox").TString;
    ticket: import("@sinclair/typebox").TString;
}>;
export declare const HubTransferRedeemResultSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"hub.transfer.redeem.result">;
    id: import("@sinclair/typebox").TString;
    ticketId: import("@sinclair/typebox").TString;
    outcome: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"accepted">, import("@sinclair/typebox").TLiteral<"replayed">, import("@sinclair/typebox").TLiteral<"refused">]>;
}>;
export declare const MeshTransferCandidatesSchema: import("@sinclair/typebox").TObject<{
    transferId: import("@sinclair/typebox").TString;
    listenerPort: import("@sinclair/typebox").TInteger;
    tlsSpkiSha256: import("@sinclair/typebox").TString;
    expiresAtMs: import("@sinclair/typebox").TInteger;
    addresses: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    kind: import("@sinclair/typebox").TLiteral<"machine.transfer.candidates">;
    id: import("@sinclair/typebox").TString;
}>;
export declare const HubTransferProbeSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"hub.transfer.probe">;
    id: import("@sinclair/typebox").TString;
    transferId: import("@sinclair/typebox").TString;
    candidates: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        readonly candidateId: import("@sinclair/typebox").TString;
        readonly tier: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"tailnet_direct">, import("@sinclair/typebox").TLiteral<"public_direct">]>;
        readonly url: import("@sinclair/typebox").TString;
        readonly tlsSpkiSha256: import("@sinclair/typebox").TString;
    }>>;
}>;
export declare const MeshTransferProbeResultSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"machine.transfer.probe.result">;
    id: import("@sinclair/typebox").TString;
    transferId: import("@sinclair/typebox").TString;
    results: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        candidateId: import("@sinclair/typebox").TString;
        outcome: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"reachable">, import("@sinclair/typebox").TLiteral<"unreachable">]>;
        roundTripMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        reasonCode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>>;
}>;
export type TerminalResult = DeepReadonly<Static<typeof terminalResult>>;
export type TerminalExecArgs = DeepReadonly<Static<(typeof meshOperationContracts.terminalExec)[0]>>;
export type TerminalWaitArgs = DeepReadonly<Static<(typeof meshOperationContracts.terminalWait)[0]>>;
export type TerminalWriteArgs = DeepReadonly<Static<(typeof meshOperationContracts.terminalWrite)[0]>>;
export type TerminalKillArgs = DeepReadonly<Static<(typeof meshOperationContracts.terminalKill)[0]>>;
export type TerminalKillResult = DeepReadonly<Static<(typeof meshOperationContracts.terminalKill)[1]>>;
export type MeshTransferRedeem = DeepReadonly<Static<typeof MeshTransferRedeemSchema>>;
export type HubTransferRedeemResult = DeepReadonly<Static<typeof HubTransferRedeemResultSchema>>;
export type MeshTransferCandidates = DeepReadonly<Static<typeof MeshTransferCandidatesSchema>>;
export type HubTransferProbe = DeepReadonly<Static<typeof HubTransferProbeSchema>>;
export type MeshTransferProbeResult = DeepReadonly<Static<typeof MeshTransferProbeResultSchema>>;
export {};
