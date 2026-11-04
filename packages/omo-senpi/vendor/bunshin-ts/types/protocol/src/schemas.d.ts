import type { TSchema } from "@sinclair/typebox";
export declare const protocolSchemaArtifacts: readonly [{
    readonly fileName: "capability-manifest.json";
    readonly schema: import("@sinclair/typebox").TObject<{
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
}, {
    readonly fileName: "command-state.json";
    readonly schema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"starting">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"waiting_input">, import("@sinclair/typebox").TLiteral<"exited">, import("@sinclair/typebox").TLiteral<"killed">, import("@sinclair/typebox").TLiteral<"lost">]>;
}, {
    readonly fileName: "disconnected.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"disconnected">;
        handleId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        reason: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"network">, import("@sinclair/typebox").TLiteral<"machine-dead">, import("@sinclair/typebox").TLiteral<"process-exited">]>;
        resumable: import("@sinclair/typebox").TBoolean;
        message: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        resumableId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        lastSeq: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>;
}, {
    readonly fileName: "doctor-report.json";
    readonly schema: import("@sinclair/typebox").TObject<{
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
    }>;
}, {
    readonly fileName: "durable-result-envelope.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        bodyArtifact: import("@sinclair/typebox").TObject<{
            envelope: import("@sinclair/typebox").TLiteral<"durable-result-envelope-v1">;
            kind: import("@sinclair/typebox").TLiteral<"artifact">;
            sha256: import("@sinclair/typebox").TString;
            size: import("@sinclair/typebox").TInteger;
            url: import("@sinclair/typebox").TString;
        }>;
    }>;
}, {
    readonly fileName: "exec-command-request.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"exec-command">;
        command: import("@sinclair/typebox").TString;
        args: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
        cwd: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        env: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TString>>;
        yieldTimeMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
    }>;
}, {
    readonly fileName: "hub-error.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"hub.error">;
        id: import("@sinclair/typebox").TString;
        code: import("@sinclair/typebox").TString;
        message: import("@sinclair/typebox").TString;
        scope: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"session">, import("@sinclair/typebox").TLiteral<"operation">]>>;
        machineId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>;
}, {
    readonly fileName: "hub-event.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"hub.event">;
        seq: import("@sinclair/typebox").TInteger;
        topic: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"device">, import("@sinclair/typebox").TLiteral<"job">, import("@sinclair/typebox").TLiteral<"message">]>;
        at: import("@sinclair/typebox").TInteger;
        machineId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        payload: import("@sinclair/typebox").TUnknown;
        gap: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<true>>;
    }>;
}, {
    readonly fileName: "hub-policy.json";
    readonly schema: import("@sinclair/typebox").TObject<{
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
}, {
    readonly fileName: "hub-request.json";
    readonly schema: import("@sinclair/typebox").TObject<{
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
        deadlineMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>;
}, {
    readonly fileName: "hub-session.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"hub.session">;
        id: import("@sinclair/typebox").TLiteral<"agent-session">;
        connectionId: import("@sinclair/typebox").TString;
    }>;
}, {
    readonly fileName: "hub-subscribe.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"hub.subscribe">;
        id: import("@sinclair/typebox").TString;
        topics: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"device">, import("@sinclair/typebox").TLiteral<"job">, import("@sinclair/typebox").TLiteral<"message">]>>;
        machineIds: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    }>;
}, {
    readonly fileName: "hub-unsubscribe.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"hub.unsubscribe">;
        id: import("@sinclair/typebox").TString;
    }>;
}, {
    readonly fileName: "hub-transfer-probe.json";
    readonly schema: import("@sinclair/typebox").TObject<{
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
}, {
    readonly fileName: "hub-transfer-redeem-result.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"hub.transfer.redeem.result">;
        id: import("@sinclair/typebox").TString;
        ticketId: import("@sinclair/typebox").TString;
        outcome: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"accepted">, import("@sinclair/typebox").TLiteral<"replayed">, import("@sinclair/typebox").TLiteral<"refused">]>;
    }>;
}, {
    readonly fileName: "mesh-invoke.json";
    readonly schema: import("@sinclair/typebox").TObject<{
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
}, {
    readonly fileName: "mesh-invoke-provenance.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        requesterSession: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        hubReceivedAtMs: import("@sinclair/typebox").TInteger;
        claimedFromMachineId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>;
}, {
    readonly fileName: "mesh-manifest.json";
    readonly schema: import("@sinclair/typebox").TObject<{
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
}, {
    readonly fileName: "mesh-response.json";
    readonly schema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
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
}, {
    readonly fileName: "mesh-transfer-candidates.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        transferId: import("@sinclair/typebox").TString;
        listenerPort: import("@sinclair/typebox").TInteger;
        tlsSpkiSha256: import("@sinclair/typebox").TString;
        expiresAtMs: import("@sinclair/typebox").TInteger;
        addresses: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
        kind: import("@sinclair/typebox").TLiteral<"machine.transfer.candidates">;
        id: import("@sinclair/typebox").TString;
    }>;
}, {
    readonly fileName: "mesh-transfer-probe-result.json";
    readonly schema: import("@sinclair/typebox").TObject<{
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
}, {
    readonly fileName: "mesh-transfer-redeem.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"machine.transfer.redeem">;
        id: import("@sinclair/typebox").TString;
        ticketId: import("@sinclair/typebox").TString;
        ticket: import("@sinclair/typebox").TString;
    }>;
}, {
    readonly fileName: "resumable.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"resumable">;
        handleId: import("@sinclair/typebox").TString;
        retainedUntil: import("@sinclair/typebox").TString;
    }>;
}, {
    readonly fileName: "shell-request.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"shell">;
        command: import("@sinclair/typebox").TString;
        cwd: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        env: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TString>>;
        timeoutMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>;
}, {
    readonly fileName: "shell-result.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        exitCode: import("@sinclair/typebox").TInteger;
        stdout: import("@sinclair/typebox").TString;
        stderr: import("@sinclair/typebox").TString;
        signal: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        timeout: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"deadline">, import("@sinclair/typebox").TLiteral<"exit-unconfirmed">]>>;
        startedAtMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        durationMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>;
}, {
    readonly fileName: "stdin-effect.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        acceptedBytes: import("@sinclair/typebox").TInteger;
        observed: import("@sinclair/typebox").TBoolean;
    }>;
}, {
    readonly fileName: "terminal-handle.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"terminal-handle">;
        handleId: import("@sinclair/typebox").TString;
        pid: import("@sinclair/typebox").TInteger;
        state: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"exited">]>;
        exitCode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>;
}, {
    readonly fileName: "terminal-lifecycle.json";
    readonly schema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
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
    }>]>;
}, {
    readonly fileName: "terminal-message.json";
    readonly schema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"shell">;
        command: import("@sinclair/typebox").TString;
        cwd: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        env: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TString>>;
        timeoutMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>, import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"exec-command">;
        command: import("@sinclair/typebox").TString;
        args: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
        cwd: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        env: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TString>>;
        yieldTimeMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
    }>, import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"write-stdin">;
        handleId: import("@sinclair/typebox").TString;
        data: import("@sinclair/typebox").TString;
        yieldTimeMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        expectActivityMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
    }>, import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"wait-for-command">;
        handleId: import("@sinclair/typebox").TString;
        yieldTimeMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
        until: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"starting">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"waiting_input">, import("@sinclair/typebox").TLiteral<"exited">, import("@sinclair/typebox").TLiteral<"killed">, import("@sinclair/typebox").TLiteral<"lost">]>>>;
    }>, import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"terminal-handle">;
        handleId: import("@sinclair/typebox").TString;
        pid: import("@sinclair/typebox").TInteger;
        state: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"exited">]>;
        exitCode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>, import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"disconnected">;
        handleId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        reason: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"network">, import("@sinclair/typebox").TLiteral<"machine-dead">, import("@sinclair/typebox").TLiteral<"process-exited">]>;
        resumable: import("@sinclair/typebox").TBoolean;
        message: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        resumableId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        lastSeq: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>, import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"resumable">;
        handleId: import("@sinclair/typebox").TString;
        retainedUntil: import("@sinclair/typebox").TString;
    }>]>;
}, {
    readonly fileName: "wait-for-command-request.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"wait-for-command">;
        handleId: import("@sinclair/typebox").TString;
        yieldTimeMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
        until: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"starting">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"waiting_input">, import("@sinclair/typebox").TLiteral<"exited">, import("@sinclair/typebox").TLiteral<"killed">, import("@sinclair/typebox").TLiteral<"lost">]>>>;
    }>;
}, {
    readonly fileName: "write-stdin-request.json";
    readonly schema: import("@sinclair/typebox").TObject<{
        kind: import("@sinclair/typebox").TLiteral<"write-stdin">;
        handleId: import("@sinclair/typebox").TString;
        data: import("@sinclair/typebox").TString;
        yieldTimeMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        expectActivityMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        lifecycleVersion: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TLiteral<1>>;
    }>;
}, ...{
    fileName: string;
    schema: TSchema;
}[]];
export declare const schemaFileNames: string[];
