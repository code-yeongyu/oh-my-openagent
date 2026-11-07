import { type Static } from "@sinclair/typebox";
import type { DeepReadonly } from "./readonly.ts";
export declare const DoctorReportSchema: import("@sinclair/typebox").TObject<{
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
export type DoctorReport = DeepReadonly<Static<typeof DoctorReportSchema>>;
