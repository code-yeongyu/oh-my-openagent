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
export type ParsedFleetEventOptions = {
    readonly topics: readonly [FleetEventTopic, ...FleetEventTopic[]];
    readonly machineIds?: readonly string[];
};
export type FleetEventSource = {
    subscribe(listener: (event: FleetEvent) => void): () => void;
    [Symbol.asyncIterator](): AsyncIterator<FleetEvent>;
};
/** Invalid `events()` filter. Rejected before any `hub.subscribe` frame is sent. */
export declare class FleetEventsError extends Error {
    constructor(message: string);
}
export declare const parseFleetEventOptions: (options: FleetEventOptions) => ParsedFleetEventOptions;
/** `event` is a valid fleet event; `drop` is a `hub.event` that must not reach pending invokes. */
export declare const takeHubEventFrame: (raw: string) => {
    readonly event: FleetEvent;
} | "drop" | undefined;
type EventSinkHooks = {
    readonly onActive?: () => void;
    readonly onIdle?: () => void;
};
/** Fan-out sink: live listeners plus per-iterator queues capped at {@link CLIENT_EVENT_QUEUE_LIMIT}. */
export declare class EventSink implements FleetEventSource {
    private readonly listeners;
    private readonly buffers;
    private closedFlag;
    private readonly hooks;
    constructor(hooks?: EventSinkHooks);
    get closed(): boolean;
    get hasConsumers(): boolean;
    private noteActive;
    private noteIdle;
    subscribe(listener: (event: FleetEvent) => void): () => void;
    [Symbol.asyncIterator](): AsyncIterator<FleetEvent>;
    push(event: FleetEvent): void;
    markReconnectGap(topic: FleetEventTopic): void;
    close(): void;
}
/** Lazy default-client adapter: property access never connects; subscribe/iterate wait for connect. */
export declare const lazyFleetEventSource: (source: Promise<FleetEventSource>) => FleetEventSource;
export {};
