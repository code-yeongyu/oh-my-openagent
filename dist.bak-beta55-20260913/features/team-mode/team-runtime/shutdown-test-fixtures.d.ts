import type { TeamModeConfig } from "../../../config/schema/team-mode";
import { sendMessage } from "../team-mailbox/send";
import { type RuntimeState, type TeamSpec } from "../types";
export declare function createConfig(baseDir: string): TeamModeConfig;
export declare function createSpec(worktreeRoot: string): TeamSpec;
export declare function createFixture(options?: {
    status?: RuntimeState["status"];
}): Promise<{
    baseDir: string;
    config: TeamModeConfig;
    teamRunId: string;
    worktreePaths: string[];
}>;
export declare function updateMemberStatuses(teamRunId: string, config: TeamModeConfig, statuses: Record<string, RuntimeState["members"][number]["status"]>): Promise<void>;
export declare function readInboxMessages(teamRunId: string, memberName: string, config: TeamModeConfig): Promise<{
    version: 1;
    messageId: string;
    from: string;
    to: string;
    kind: "announcement" | "message" | "shutdown_approved" | "shutdown_rejected" | "shutdown_request";
    body: string;
    summary?: string | undefined;
    references?: {
        path: string;
        description?: string | undefined;
    }[] | undefined;
    timestamp: number;
    correlationId?: string | undefined;
    color?: string | undefined;
}[]>;
export declare function createTestMessage(overrides?: Partial<Parameters<typeof sendMessage>[0]>): {
    version: 1;
    messageId: string;
    from: string;
    to: string;
    kind: "announcement" | "message" | "shutdown_approved" | "shutdown_rejected" | "shutdown_request";
    body: string;
    summary?: string | undefined;
    references?: {
        path: string;
        description?: string | undefined;
    }[] | undefined;
    timestamp: number;
    correlationId?: string | undefined;
    color?: string | undefined;
};
