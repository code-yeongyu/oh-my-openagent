type BridgeSource = "ssh_config" | "tailscale" | "manual";
type BridgeErrorCode = "bridge_disabled" | "bridge_target_unknown" | "bridge_target_unreachable" | "bridge_auth_denied" | "bridge_hostkey_mismatch" | "bridge_tier_unsupported" | "bridge_cycle" | "bridge_timeout";
type BridgeProbe = {
    readonly state: "unknown" | "reachable" | "unreachable" | "attention" | "disabled";
    readonly rttMs: number | null;
    readonly at: number | null;
    readonly reason: BridgeErrorCode | "hostkey_unpinned" | "protocol_mismatch" | "probe_budget_exhausted" | "identity_conflict" | null;
};
export type Constraint = {
    readonly kind: "any";
} | {
    readonly kind: "exact";
    readonly value: unknown;
} | {
    readonly kind: "prefix";
    readonly prefix: string;
} | {
    readonly kind: "oneOf";
    readonly values: readonly unknown[];
} | {
    readonly kind: "range";
    readonly min: number;
    readonly max: number;
};
export type ArtifactRef = {
    readonly kind: "artifact";
    readonly sha256: string;
    readonly size: number;
    readonly url: string;
};
type BridgePolicy = {
    readonly enabled?: boolean;
    readonly sources?: readonly BridgeSource[];
    readonly targets?: readonly {
        readonly target: string;
        readonly enabled?: boolean;
        readonly hostKeyFp?: readonly string[];
        readonly home?: string;
    }[];
};
type HubPolicy = {
    readonly kind: "hub.policy";
    readonly tags?: readonly string[];
    readonly alias?: string;
    readonly pathAppend?: readonly string[];
    readonly longShellBudgetMs?: number;
    readonly bridge?: BridgePolicy;
};
type RoutePreference = "auto" | "direct" | "bridge" | {
    readonly via: string;
    readonly target?: string;
};
type DirectRoute = Readonly<{
    kind: "direct";
    machineId: string;
    online: boolean;
    capabilities: readonly string[];
}>;
type SshRoute = Readonly<{
    kind: "ssh";
    via: string;
    target: string;
    hostKeyFp: readonly string[];
    tier: 0 | 1 | null;
    probe: BridgeProbe;
    bridgeReceivedAtMs: number | null;
    viaOnline: boolean;
    enabled: boolean;
    online: boolean;
    identityConflict: boolean;
    capabilities: readonly string[];
}>;
export type Route = DirectRoute | SshRoute;
type OperationMetadata = Readonly<{
    taskId: string;
    opSeq: number;
    effect: "read" | "mutate";
    opId?: string;
    capabilityToken?: string;
}>;
export type MachineToolDefinition = {
    readonly name: string;
    readonly capability: string;
    readonly inputSchema: {
        readonly [key: string]: unknown;
    };
    readonly transport: "built-in" | "sidecar" | "native";
    readonly version: string;
    readonly description?: string;
};
export type FleetEventTopic = "device" | "job" | "message";
export type FleetEvent = {
    readonly topic: FleetEventTopic;
    readonly seq: number;
    readonly at: number;
    readonly machineId?: string;
    readonly payload: unknown;
    readonly gap?: true;
};
export type FleetEventOptions = {
    readonly topics: readonly FleetEventTopic[];
    readonly machineIds?: readonly string[];
};
export type FleetEventSource = {
    subscribe(listener: (event: FleetEvent) => void): () => void;
    [Symbol.asyncIterator](): AsyncIterator<FleetEvent>;
};
export type DevicePolicy = Omit<HubPolicy, "kind">;
export type MachineTransportKind = "relay" | "hub";
type MachineRouting = {
    readonly kind: "enrolled" | "bridged";
    readonly via?: string;
    readonly routes: readonly Route[];
    readonly connection: "hub" | "relay" | "ssh" | "none";
    readonly identityConflict?: boolean;
};
type LegacyMachineRouting = {
    readonly kind?: never;
    readonly via?: never;
    readonly routes?: never;
    readonly connection?: never;
    readonly identityConflict?: never;
};
type MachineRowFields = {
    readonly id: string;
    readonly alias: string;
    readonly os: string;
    readonly arch: string;
    readonly tags: readonly string[];
    readonly policy?: DevicePolicy;
    readonly state: "online" | "offline";
    readonly lastActivityMs?: number;
    readonly lastSeenMs?: number;
    readonly onlineBasis?: "activity" | "bridge-probe";
    readonly attention?: string | null;
    readonly protocolFeatures?: readonly string[];
    readonly build?: Readonly<{
        version: string;
        binarySha256: string;
        onDiskSha256?: string;
        installPath?: string;
    }>;
    readonly host?: Readonly<{
        load1: number;
        cores: number;
    }>;
    readonly restartNeeded?: boolean;
    readonly unsupported?: boolean;
};
export type StandaloneMachineRecord = (MachineRouting | LegacyMachineRouting) & MachineRowFields;
export type CapabilityTokenMintInput = {
    readonly machineId: string;
    readonly allowedOps: readonly string[];
    readonly pathJail: string;
    readonly argConstraints?: Readonly<Record<string, Constraint>>;
    readonly taskId?: string;
    readonly ttlMs?: number;
    readonly notBefore?: number;
};
export type CapabilityTokenMintResult = {
    readonly token: string;
    readonly expiry: number;
};
export type DurableResultStatus = {
    readonly state: "in-flight";
} | {
    readonly state: "terminal";
    readonly result: unknown;
};
type DurableArtifactResolver = (ref: ArtifactRef) => Promise<{
    readonly ref: ArtifactRef;
    readonly signal: AbortSignal;
}>;
export type MachineOperationMetadata = OperationMetadata & {
    readonly route?: RoutePreference;
};
type RouteRefusalExplainer = (machine: StandaloneMachineRecord & MachineRouting, capability: string, preference: RoutePreference) => string | undefined;
type TransportCredentialRefresh = {
    readonly refreshBeforeExpiryMs: number;
    readonly expiresAtMs: () => number;
    readonly refreshSession: () => Promise<void>;
};
export interface MachineHubTransport {
    readonly kind?: MachineTransportKind;
    readonly normalizesDurableResults?: true;
    readonly resolveArtifact?: DurableArtifactResolver;
    readonly fetchArtifact?: typeof fetch;
    uploadArtifact?(bytes: Uint8Array): Promise<ArtifactRef>;
    connect(): Promise<void>;
    close(): Promise<void>;
    listMachines(): Promise<readonly StandaloneMachineRecord[]>;
    listTools(machineId: string): Promise<readonly MachineToolDefinition[]>;
    invoke(machineId: string, capability: string, args?: unknown, metadata?: MachineOperationMetadata, terminalTimeoutMs?: number, signal?: AbortSignal): Promise<unknown>;
    mintCapabilityToken?(input: CapabilityTokenMintInput): Promise<CapabilityTokenMintResult>;
    readonly explainRouteRefusal?: RouteRefusalExplainer;
    readonly credentialRefresh?: TransportCredentialRefresh;
    resultOf?(requestId: string): Promise<DurableResultStatus>;
    events?(options: FleetEventOptions): FleetEventSource;
    setPolicy?(machineId: string, policy: DevicePolicy): Promise<DevicePolicy>;
    getPolicy?(machineId: string): Promise<DevicePolicy>;
}
export {};
