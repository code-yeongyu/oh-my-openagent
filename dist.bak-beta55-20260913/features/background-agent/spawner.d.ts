import type { ConcurrencyManager } from "./concurrency";
import type { OnSubagentSessionCreated, OpencodeClient, QueueItem } from "./constants";
import type { BackgroundTask, LaunchInput, ResumeInput } from "./types";
import { buildFallbackBody, FALLBACK_AGENT, isAgentNotFoundError } from "./spawner/fallback-agent";
export { buildFallbackBody, FALLBACK_AGENT, isAgentNotFoundError };
export interface SpawnerContext {
    client: OpencodeClient;
    directory: string;
    concurrencyManager: ConcurrencyManager;
    tmuxEnabled: boolean;
    onSubagentSessionCreated?: OnSubagentSessionCreated;
    onTaskError: (task: BackgroundTask, error: Error) => void;
}
export declare function createTask(input: LaunchInput): BackgroundTask;
export declare function startTask(item: QueueItem, ctx: SpawnerContext): Promise<void>;
export declare function resumeTask(task: BackgroundTask, input: ResumeInput, ctx: Pick<SpawnerContext, "client" | "concurrencyManager" | "directory" | "onTaskError">): Promise<void>;
