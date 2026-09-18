import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide";
import { log } from "../../shared/logger";
type OnCompleteHookDeps = {
    spawnWithWindowsHide: typeof spawnWithWindowsHide;
    log: typeof log;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
};
export declare function executeOnCompleteHook(options: {
    command: string;
    sessionId: string;
    exitCode: number;
    durationMs: number;
    messageCount: number;
}, deps?: OnCompleteHookDeps): Promise<void>;
export {};
