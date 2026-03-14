import type { OpencodeClient } from "../../tools/delegate-task/types";
import type { TrackedSession } from "./types";
export declare class TmuxPollingManager {
    private client;
    private sessions;
    private closeSessionById;
    private pollInterval?;
    private pollingInFlight;
    constructor(client: OpencodeClient, sessions: Map<string, TrackedSession>, closeSessionById: (sessionId: string) => Promise<void>);
    startPolling(): void;
    stopPolling(): void;
    private pollSessions;
}
