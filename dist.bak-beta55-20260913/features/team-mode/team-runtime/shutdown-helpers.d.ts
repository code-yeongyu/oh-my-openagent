import type { Message, RuntimeState } from "../types";
export declare const DELETABLE_MEMBER_STATUSES: Set<"completed" | "errored" | "idle" | "pending" | "running" | "shutdown_approved">;
export declare function createShutdownMessage(from: string, to: string, kind: Message["kind"], body: string): Message;
export declare function getRuntimeMember(runtimeState: RuntimeState, memberName: string): RuntimeState["members"][number];
export declare function getLeadMemberName(runtimeState: RuntimeState): string;
export declare function createSendContext(runtimeState: RuntimeState, senderName: string): {
    isLead: boolean;
    activeMembers: string[];
};
export declare function findLatestShutdownRequestIndex(runtimeState: RuntimeState, memberName: string, requesterName?: string): number;
export declare function removeWorktrees(memberPaths: Array<string | undefined>): Promise<string[]>;
