import type { PluginInput } from "@opencode-ai/plugin";
import type { TmuxConfig } from "../../config/schema";
import type { CapacityConfig, TrackedSession } from "./types";
import { queryWindowState } from "./pane-state-querier";
import { type SessionMapping } from "./decision-engine";
import { executeActions } from "./action-executor";
import type { SessionCreatedEvent } from "./session-created-event";
type OpencodeClient = PluginInput["client"];
export interface SessionCreatedHandlerDeps {
    client: OpencodeClient;
    tmuxConfig: TmuxConfig;
    directory: string;
    serverUrl: string;
    sourcePaneId: string | undefined;
    sessions: Map<string, TrackedSession>;
    pendingSessions: Set<string>;
    isInsideTmux: () => boolean;
    isEnabled: () => boolean;
    getCapacityConfig: () => CapacityConfig;
    getSessionMappings: () => SessionMapping[];
    waitForSessionReady: (sessionId: string) => Promise<boolean>;
    startPolling: () => void;
    queryWindowState?: typeof queryWindowState;
    executeActions?: typeof executeActions;
}
export declare function handleSessionCreated(deps: SessionCreatedHandlerDeps, event: SessionCreatedEvent): Promise<void>;
export {};
