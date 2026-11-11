import { type Static } from "@sinclair/typebox";
import type { DeepReadonly } from "./readonly.ts";
export declare const MeshInvokeSchema: import("@sinclair/typebox").TObject<{
    opId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    effect: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"read">, import("@sinclair/typebox").TLiteral<"mutate">]>>;
    opSeq: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    taskId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    capabilityToken: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    kind: import("@sinclair/typebox").TLiteral<"machine.invoke">;
    id: import("@sinclair/typebox").TString;
    capability: import("@sinclair/typebox").TString;
    args: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnknown>;
    deliveryId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    deadlineAtMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    requesterSession: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    provenance: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        requesterSession: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        hubReceivedAtMs: import("@sinclair/typebox").TInteger;
        claimedFromMachineId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>>;
}>;
export declare const MeshResponseSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"machine.response">;
    id: import("@sinclair/typebox").TString;
    deliveryId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    result: import("@sinclair/typebox").TUnknown;
}>, import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"machine.response">;
    id: import("@sinclair/typebox").TString;
    deliveryId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    error: import("@sinclair/typebox").TObject<{
        code: import("@sinclair/typebox").TString;
        message: import("@sinclair/typebox").TString;
    }>;
}>, import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"machine.response">;
    id: import("@sinclair/typebox").TString;
    deliveryId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    result: import("@sinclair/typebox").TUnknown;
    error: import("@sinclair/typebox").TObject<{
        code: import("@sinclair/typebox").TString;
        message: import("@sinclair/typebox").TString;
    }>;
}>]>;
export declare const MeshManifestSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"machine.manifest">;
    id: import("@sinclair/typebox").TString;
    capabilities: import("@sinclair/typebox").TObject<{
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
    }>;
}>;
export declare const HubRequestSchema: import("@sinclair/typebox").TObject<{
    opId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    effect: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"read">, import("@sinclair/typebox").TLiteral<"mutate">]>>;
    opSeq: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    taskId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    capabilityToken: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    kind: import("@sinclair/typebox").TLiteral<"hub.request">;
    id: import("@sinclair/typebox").TString;
    targetMachineId: import("@sinclair/typebox").TString;
    capability: import("@sinclair/typebox").TString;
    args: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnknown>;
    durable: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    route: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"auto">, import("@sinclair/typebox").TLiteral<"direct">, import("@sinclair/typebox").TLiteral<"bridge">, import("@sinclair/typebox").TObject<{
        via: import("@sinclair/typebox").TString;
        target: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>]>>;
    /** The requester's own end-to-end budget for this invoke, in milliseconds from submit. The journal
     *  records `min(deadlineMs, DURABLE_INVOKE_MAX_BUDGET_MS)`; absent, it falls back to the ceiling. Without
     *  this a 15 s restart command stayed redeliverable for 61 minutes, and every reconnect re-ran it. */
    deadlineMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
}>;
export declare const HubSubscribeSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"hub.subscribe">;
    id: import("@sinclair/typebox").TString;
    topics: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"device">, import("@sinclair/typebox").TLiteral<"job">, import("@sinclair/typebox").TLiteral<"message">]>>;
    machineIds: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
}>;
export declare const HubUnsubscribeSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"hub.unsubscribe">;
    id: import("@sinclair/typebox").TString;
}>;
export declare const HubEventSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"hub.event">;
    seq: import("@sinclair/typebox").TInteger;
    topic: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"device">, import("@sinclair/typebox").TLiteral<"job">, import("@sinclair/typebox").TLiteral<"message">]>;
    at: import("@sinclair/typebox").TInteger;
    machineId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    payload: import("@sinclair/typebox").TUnknown;
    gap: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
}>;
export declare const HubSessionSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"hub.session">;
    id: import("@sinclair/typebox").TLiteral<"agent-session">;
    connectionId: import("@sinclair/typebox").TString;
}>;
export declare const HubPolicySchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"hub.policy">;
    tags: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    alias: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    pathAppend: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    longShellBudgetMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    bridge: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        enabled: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
        sources: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"ssh_config">, import("@sinclair/typebox").TLiteral<"tailscale">, import("@sinclair/typebox").TLiteral<"manual">]>>>;
        targets: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            target: import("@sinclair/typebox").TString;
            enabled: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
            hostKeyFp: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
            home: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        }>>>;
    }>>;
}>;
export declare const HubErrorSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"hub.error">;
    id: import("@sinclair/typebox").TString;
    code: import("@sinclair/typebox").TString;
    message: import("@sinclair/typebox").TString;
    scope: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"session">, import("@sinclair/typebox").TLiteral<"operation">]>>;
    machineId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
export type MeshInvoke = DeepReadonly<Static<typeof MeshInvokeSchema>>;
export type MeshResponse = DeepReadonly<Static<typeof MeshResponseSchema>>;
export type MeshManifest = DeepReadonly<Static<typeof MeshManifestSchema>>;
export type HubRequest = DeepReadonly<Static<typeof HubRequestSchema>>;
export type HubError = DeepReadonly<Static<typeof HubErrorSchema>>;
export type HubSubscribe = DeepReadonly<Static<typeof HubSubscribeSchema>>;
export type HubUnsubscribe = DeepReadonly<Static<typeof HubUnsubscribeSchema>>;
export type HubEvent = DeepReadonly<Static<typeof HubEventSchema>>;
export type HubSession = DeepReadonly<Static<typeof HubSessionSchema>>;
export type HubPolicy = DeepReadonly<Static<typeof HubPolicySchema>>;
