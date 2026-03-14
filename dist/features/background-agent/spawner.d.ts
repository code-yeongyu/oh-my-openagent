import type { BackgroundTask, LaunchInput, ResumeInput } from "./types";
import type { OpencodeClient, OnSubagentSessionCreated, QueueItem } from "./constants";
import type { ConcurrencyManager } from "./concurrency";
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
export declare function resumeTask(task: BackgroundTask, input: ResumeInput, ctx: Pick<SpawnerContext, "client" | "concurrencyManager" | "onTaskError">): Promise<void>;
