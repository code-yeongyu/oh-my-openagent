import type { BridgeTarget } from "./capability.ts";
/** The hub reaches the machine over its own agent connection. */
export type DirectRoute = Readonly<{
    kind: "direct";
    machineId: string;
    online: boolean;
    capabilities: readonly string[];
}>;
/** The hub reaches a bridged target over SSH through an enrolled via machine. */
export type SshRoute = Readonly<{
    kind: "ssh";
    via: string;
    target: string;
    hostKeyFp: readonly string[];
    tier: 0 | 1 | null;
    probe: BridgeTarget["probe"];
    bridgeReceivedAtMs: number | null;
    viaOnline: boolean;
    enabled: boolean;
    online: boolean;
    identityConflict: boolean;
    capabilities: readonly string[];
}>;
/** One way to reach a directory row, as the hub's directory reports it. */
export type Route = DirectRoute | SshRoute;
