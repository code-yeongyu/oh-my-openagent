import type { PluginInput } from "@opencode-ai/plugin";
export declare function isOmoWorkspacePath(canonicalPath: string): boolean;
export declare function handleWriteExistingFileGuardToolExecuteBefore(params: {
    ctx: PluginInput;
    input: {
        tool?: string;
        sessionID?: string;
    };
    output: {
        args?: unknown;
    };
    readPermissionsBySession: Map<string, Set<string>>;
    sessionLastAccess: Map<string, number>;
    getCanonicalSessionRoot: () => string;
    maxTrackedSessions: number;
    maxTrackedPathsPerSession?: number;
}): Promise<void>;
