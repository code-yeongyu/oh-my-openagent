import { type Static } from "@sinclair/typebox";
import type { DeepReadonly } from "./readonly.ts";
export declare const BridgeDestinationSchema: import("@sinclair/typebox").TString;
export declare const SshHostKeyFingerprintSchema: import("@sinclair/typebox").TString;
export declare const SshHostKeyFingerprintsSchema: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
export declare const BridgeSourcesSchema: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"ssh_config">, import("@sinclair/typebox").TLiteral<"tailscale">, import("@sinclair/typebox").TLiteral<"manual">]>>;
export declare const BridgeTierSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<0>, import("@sinclair/typebox").TLiteral<1>]>;
export declare const BridgeErrorCodeSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"bridge_disabled">, import("@sinclair/typebox").TLiteral<"bridge_target_unknown">, import("@sinclair/typebox").TLiteral<"bridge_target_unreachable">, import("@sinclair/typebox").TLiteral<"bridge_auth_denied">, import("@sinclair/typebox").TLiteral<"bridge_hostkey_mismatch">, import("@sinclair/typebox").TLiteral<"bridge_tier_unsupported">, import("@sinclair/typebox").TLiteral<"bridge_cycle">, import("@sinclair/typebox").TLiteral<"bridge_timeout">]>;
export declare const BridgeTargetSchema: import("@sinclair/typebox").TObject<{
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
}>;
export declare const BridgeManifestSchema: import("@sinclair/typebox").TObject<{
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
}>;
export type BridgeManifest = DeepReadonly<Static<typeof BridgeManifestSchema>>;
export type BridgeTarget = DeepReadonly<Static<typeof BridgeTargetSchema>>;
export declare const CapabilityManifestSchema: import("@sinclair/typebox").TObject<{
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
export type CapabilityManifest = DeepReadonly<Static<typeof CapabilityManifestSchema>>;
export declare const ConstraintSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"any">;
}>, import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"exact">;
    value: import("@sinclair/typebox").TUnknown;
}>, import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"prefix">;
    prefix: import("@sinclair/typebox").TString;
}>, import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"oneOf">;
    values: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnknown>;
}>, import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"range">;
    min: import("@sinclair/typebox").TNumber;
    max: import("@sinclair/typebox").TNumber;
}>]>;
export type Constraint = DeepReadonly<Static<typeof ConstraintSchema>>;
export declare const CapabilityTokenSchema: import("@sinclair/typebox").TObject<{
    ver: import("@sinclair/typebox").TLiteral<1>;
    issuer: import("@sinclair/typebox").TString;
    accountId: import("@sinclair/typebox").TString;
    machineId: import("@sinclair/typebox").TString;
    taskId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    allowedOps: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    pathJail: import("@sinclair/typebox").TString;
    argConstraints: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"any">;
    }>, import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"exact">;
        value: import("@sinclair/typebox").TUnknown;
    }>, import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"prefix">;
        prefix: import("@sinclair/typebox").TString;
    }>, import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"oneOf">;
        values: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnknown>;
    }>, import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"range">;
        min: import("@sinclair/typebox").TNumber;
        max: import("@sinclair/typebox").TNumber;
    }>]>>;
    notBefore: import("@sinclair/typebox").TInteger;
    expiry: import("@sinclair/typebox").TInteger;
    nonce: import("@sinclair/typebox").TString;
    sig: import("@sinclair/typebox").TString;
}>;
export type CapabilityToken = DeepReadonly<Static<typeof CapabilityTokenSchema>>;
export declare const ReleaseFileSchema: import("@sinclair/typebox").TObject<{
    path: import("@sinclair/typebox").TString;
    contentsBase64: import("@sinclair/typebox").TString;
}>;
export declare const ReleaseHealthCheckSchema: import("@sinclair/typebox").TObject<{
    command: import("@sinclair/typebox").TString;
    timeoutMs: import("@sinclair/typebox").TInteger;
}>;
export declare const ReleaseRequestSchema: import("@sinclair/typebox").TObject<{
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
}>;
export type ReleaseRequest = DeepReadonly<Static<typeof ReleaseRequestSchema>>;
export declare const ReleaseOutcomeSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
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
}>]>;
export type ReleaseOutcome = DeepReadonly<Static<typeof ReleaseOutcomeSchema>>;
export declare const ArtifactPutRequestSchema: import("@sinclair/typebox").TObject<{
    sha256: import("@sinclair/typebox").TString;
    size: import("@sinclair/typebox").TInteger;
}>;
export declare const ArtifactPutResultSchema: import("@sinclair/typebox").TObject<{
    uploadUrl: import("@sinclair/typebox").TString;
    sha256: import("@sinclair/typebox").TString;
}>;
export declare const ArtifactGetRequestSchema: import("@sinclair/typebox").TObject<{
    sha256: import("@sinclair/typebox").TString;
}>;
export declare const ArtifactGetResultSchema: import("@sinclair/typebox").TObject<{
    downloadUrl: import("@sinclair/typebox").TString;
    sha256: import("@sinclair/typebox").TString;
}>;
export declare const ArtifactRefSchema: import("@sinclair/typebox").TObject<{
    kind: import("@sinclair/typebox").TLiteral<"artifact">;
    sha256: import("@sinclair/typebox").TString;
    size: import("@sinclair/typebox").TInteger;
    url: import("@sinclair/typebox").TString;
}>;
export type ArtifactPutRequest = DeepReadonly<Static<typeof ArtifactPutRequestSchema>>;
export type ArtifactPutResult = DeepReadonly<Static<typeof ArtifactPutResultSchema>>;
export type ArtifactGetRequest = DeepReadonly<Static<typeof ArtifactGetRequestSchema>>;
export type ArtifactGetResult = DeepReadonly<Static<typeof ArtifactGetResultSchema>>;
export type ArtifactRef = DeepReadonly<Static<typeof ArtifactRefSchema>>;
