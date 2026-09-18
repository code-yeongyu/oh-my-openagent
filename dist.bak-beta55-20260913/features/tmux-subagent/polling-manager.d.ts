import type { OpencodeClient } from "../../tools/delegate-task/types";
import type { TrackedSession, WindowState } from "./types";
export declare class TmuxPollingManager {
    private client;
    private sessions;
    private closeSessionById;
    private retryPendingCloses?;
    private getWindowState?;
    private activateSessionPane?;
    private canActivatePane;
    private pollInterval?;
    private pollingInFlight;
    constructor(client: OpencodeClient, sessions: Map<string, TrackedSession>, closeSessionById: (sessionId: string) => Promise<void>, retryPendingCloses?: (() => Promise<void>) | undefined, getWindowState?: (() => Promise<WindowState | null>) | undefined, activateSessionPane?: ((tracked: TrackedSession) => Promise<boolean>) | undefined, canActivatePane?: (state: WindowState) => boolean);
    handleEvent(event: {
        type: string;
        properties?: Record<string, unknown>;
    }): void;
    startPolling(): void;
    stopPolling(): void;
    private pollSessions;
    private getEventSessionId;
    private activateFocusedPanes;
}
