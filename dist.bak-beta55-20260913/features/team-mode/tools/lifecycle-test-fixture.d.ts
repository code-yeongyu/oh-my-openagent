import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";
import type { OpencodeClient } from "../../../tools/delegate-task/types";
import type { BackgroundManager } from "../../background-agent/manager";
import type { RuntimeState, TeamSpec } from "@oh-my-opencode/team-core/types";
export declare function parseToolResult<TValue>(value: ToolResult): TValue;
export declare function createToolContext(sessionID: string): ToolContext;
export declare function getLatestShutdownRequest(runtimeState: RuntimeState, memberName: string): RuntimeState["shutdownRequests"][number] | undefined;
export declare function createSpec(): TeamSpec;
export declare function requireRuntime(teamRunId: string): RuntimeState;
export declare const createTeamRunMock: import("bun:test").Mock<(spec: TeamSpec, leadSessionId: string) => Promise<{
    version: 1;
    teamRunId: string;
    teamName: string;
    specSource: "project" | "user";
    createdAt: number;
    status: "active" | "creating" | "deleted" | "deleting" | "failed" | "orphaned" | "shutdown_requested";
    leadSessionId?: string | undefined;
    tmuxLayout?: {
        ownedSession: boolean;
        targetSessionId: string;
        focusWindowId?: string | undefined;
        gridWindowId?: string | undefined;
        paneIds?: string[] | undefined;
    } | undefined;
    members: {
        name: string;
        sessionId?: string | undefined;
        tmuxPaneId?: string | undefined;
        tmuxGridPaneId?: string | undefined;
        agentType: "general-purpose" | "leader";
        subagent_type?: string | undefined;
        category?: string | undefined;
        model?: {
            providerID: string;
            modelID: string;
            variant?: string | undefined;
            reasoningEffort?: string | undefined;
            temperature?: number | undefined;
            top_p?: number | undefined;
            maxTokens?: number | undefined;
            thinking?: {
                type: "disabled" | "enabled";
                budgetTokens?: number | undefined;
            } | undefined;
        } | undefined;
        status: "completed" | "errored" | "idle" | "pending" | "running" | "shutdown_approved";
        color?: string | undefined;
        worktreePath?: string | undefined;
        lastInjectedTurnMarker?: string | undefined;
        pendingInjectedMessageIds: string[];
    }[];
    shutdownRequests: {
        memberId: string;
        requesterName: string;
        requestedAt: number;
        approvedAt?: number | undefined;
        rejectedReason?: string | undefined;
        rejectedAt?: number | undefined;
    }[];
    bounds: {
        maxMembers: number;
        maxParallelMembers: number;
        maxMessagesPerRun: number;
        maxWallClockMinutes: number;
        maxMemberTurns: number;
    };
}>>;
export declare const deleteTeamMock: import("bun:test").Mock<(teamRunId: string, _config?: unknown, _tmuxMgr?: unknown, _bgMgr?: unknown, options?: {
    force?: boolean;
}) => Promise<{
    removedWorktrees: never[];
    removedLayout: boolean;
}>>;
export declare const requestShutdownOfMemberMock: import("bun:test").Mock<(teamRunId: string, targetMemberName: string, requesterName: string) => Promise<void>>;
export declare const approveShutdownMock: import("bun:test").Mock<(teamRunId: string, memberName: string) => Promise<void>>;
export declare const rejectShutdownMock: import("bun:test").Mock<(teamRunId: string, memberName: string, _rejectorName: string, reason: string) => Promise<void>>;
export declare const loadTeamSpecMock: import("bun:test").Mock<() => Promise<{
    version: 1;
    name: string;
    description?: string | undefined;
    createdAt: number;
    leadAgentId?: string | undefined;
    teamAllowedPaths?: string[] | undefined;
    sessionPermission?: string | undefined;
    members: ({
        name: string;
        cwd?: string | undefined;
        worktreePath?: string | undefined;
        task_summary?: string | undefined;
        subscriptions?: string[] | undefined;
        backendType: "in-process" | "tmux";
        color?: string | undefined;
        isActive: boolean;
        kind: "category";
        category: string;
        prompt: string;
    } | {
        name: string;
        cwd?: string | undefined;
        worktreePath?: string | undefined;
        task_summary?: string | undefined;
        subscriptions?: string[] | undefined;
        backendType: "in-process" | "tmux";
        color?: string | undefined;
        isActive: boolean;
        kind: "subagent_type";
        subagent_type: string;
        prompt?: string | undefined;
    })[];
}>>;
export declare const listActiveTeamsMock: import("bun:test").Mock<() => Promise<{
    teamRunId: string;
    teamName: string;
    status: "active" | "creating" | "deleted" | "deleting" | "failed" | "orphaned" | "shutdown_requested";
    memberCount: number;
    scope: "project" | "user";
}[]>>;
export declare const loadRuntimeStateMock: import("bun:test").Mock<(teamRunId: string) => Promise<{
    version: 1;
    teamRunId: string;
    teamName: string;
    specSource: "project" | "user";
    createdAt: number;
    status: "active" | "creating" | "deleted" | "deleting" | "failed" | "orphaned" | "shutdown_requested";
    leadSessionId?: string | undefined;
    tmuxLayout?: {
        ownedSession: boolean;
        targetSessionId: string;
        focusWindowId?: string | undefined;
        gridWindowId?: string | undefined;
        paneIds?: string[] | undefined;
    } | undefined;
    members: {
        name: string;
        sessionId?: string | undefined;
        tmuxPaneId?: string | undefined;
        tmuxGridPaneId?: string | undefined;
        agentType: "general-purpose" | "leader";
        subagent_type?: string | undefined;
        category?: string | undefined;
        model?: {
            providerID: string;
            modelID: string;
            variant?: string | undefined;
            reasoningEffort?: string | undefined;
            temperature?: number | undefined;
            top_p?: number | undefined;
            maxTokens?: number | undefined;
            thinking?: {
                type: "disabled" | "enabled";
                budgetTokens?: number | undefined;
            } | undefined;
        } | undefined;
        status: "completed" | "errored" | "idle" | "pending" | "running" | "shutdown_approved";
        color?: string | undefined;
        worktreePath?: string | undefined;
        lastInjectedTurnMarker?: string | undefined;
        pendingInjectedMessageIds: string[];
    }[];
    shutdownRequests: {
        memberId: string;
        requesterName: string;
        requestedAt: number;
        approvedAt?: number | undefined;
        rejectedReason?: string | undefined;
        rejectedAt?: number | undefined;
    }[];
    bounds: {
        maxMembers: number;
        maxParallelMembers: number;
        maxMessagesPerRun: number;
        maxWallClockMinutes: number;
        maxMemberTurns: number;
    };
}>>;
export declare const config: {
    enabled: boolean;
    tmux_visualization: boolean;
    max_parallel_members: number;
    max_members: number;
    max_messages_per_run: number;
    max_wall_clock_minutes: number;
    max_member_turns: number;
    base_dir?: string | undefined;
    message_payload_max_bytes: number;
    recipient_unread_max_bytes: number;
    mailbox_poll_interval_ms: number;
};
export declare const mockClient: OpencodeClient;
export declare const backgroundManager: BackgroundManager;
export declare function resetLifecycleTestState(): void;
export declare function hasRuntime(teamRunId: string): boolean;
