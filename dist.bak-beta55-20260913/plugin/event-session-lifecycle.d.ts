import type { OhMyOpenCodeConfig } from "../config";
import type { Managers } from "../create-managers";
import type { FirstMessageVariantGate, PluginEventContext } from "./event-types";
export declare const TMUX_ACTIVITY_EVENT_TYPES: ReadonlySet<string>;
export declare function isCompactionAgent(agent: string): boolean;
export declare function shouldDispatchOpenClawSessionEvent(sessionID: string): boolean;
export declare function dispatchOpenClawSessionEvent(args: {
    pluginConfig: OhMyOpenCodeConfig;
    pluginContext: PluginEventContext;
    managers: Managers;
    rawEvent: string;
    sessionID: string;
}): Promise<void>;
export declare function handleSessionCreatedEvent(args: {
    event: {
        type: string;
        properties?: unknown;
    };
    props?: Record<string, unknown>;
    tmuxIntegrationEnabled: boolean;
    pluginConfig: OhMyOpenCodeConfig;
    pluginContext: PluginEventContext;
    managers: Managers;
    firstMessageVariantGate: FirstMessageVariantGate;
}): Promise<void>;
export declare function handleSessionDeletedEvent(args: {
    props?: Record<string, unknown>;
    tmuxIntegrationEnabled: boolean;
    pluginConfig: OhMyOpenCodeConfig;
    pluginContext: PluginEventContext;
    managers: Managers;
    firstMessageVariantGate: FirstMessageVariantGate;
    clearModelFallbackSession: (sessionID: string) => void;
}): Promise<void>;
export declare function handleMessageRemovedEvent(props?: Record<string, unknown>): void;
export declare function handleMessageUpdatedSessionState(args: {
    props?: Record<string, unknown>;
    noteSessionModel: (sessionID: string, model: {
        providerID: string;
        modelID: string;
    }) => void;
}): {
    info: Record<string, unknown> | undefined;
    sessionID: string | undefined;
    agent: string | undefined;
    role: string | undefined;
};
