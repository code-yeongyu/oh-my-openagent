export declare const LIVE_ROUTE_DISPATCH_LOG = "[live-server-route] dispatch via live listener";
export declare const LIVE_ROUTE_UNAVAILABLE_LOG = "[live-server-route] route unavailable; using in-process client";
type RouteResult = {
    client: unknown;
    route: "live" | "in-process";
    reason: "identity" | "flag" | "child" | "unavailable" | "live" | "affinity";
};
type FetchImpl = typeof fetch;
export declare function _setFetchImplementationForTesting(impl: FetchImpl | undefined): void;
export declare function _setLiveClientForTesting(client: unknown): void;
export declare function setLiveParentWakeRoutingDisabled(disabled: boolean): void;
export declare function isLiveParentWakeRoutingDisabled(): boolean;
export declare function initLiveServerRoute(opts: {
    serverUrl: URL | undefined;
    directory: string;
    inProcessClient: unknown;
}): void;
export declare function warmLiveServerProbe(): void;
export declare function tryResolveDispatchClientSync(client: unknown, sessionID: string): RouteResult | undefined;
export declare function resolveDispatchClient(client: unknown, sessionID: string): Promise<RouteResult>;
export declare function isPreSendConnectionFailure(error: unknown): boolean;
export declare function markLiveRouteUnavailable(reason: string): void;
export declare function resetLiveServerRouteForTesting(): void;
export {};
