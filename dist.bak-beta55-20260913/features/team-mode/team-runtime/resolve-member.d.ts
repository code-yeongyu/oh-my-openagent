import type { FallbackEntry } from "../../../shared/model-requirements";
import type { DelegatedModelConfig } from "../../../shared/model-resolution-types";
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types";
import type { Member } from "../types";
export declare class TeamMemberResolutionError extends Error {
    readonly memberName: string;
    readonly cause: Error;
    constructor(memberName: string, cause: Error);
}
export interface ResolvedMember {
    memberName: string;
    agentToUse: string;
    model: DelegatedModelConfig | undefined;
    fallbackChain: FallbackEntry[] | undefined;
    systemContent: string;
}
export declare function resolveMember(member: Member, ctx: ExecutorContext, categoryExamples: string, parentAgent?: string): Promise<ResolvedMember>;
