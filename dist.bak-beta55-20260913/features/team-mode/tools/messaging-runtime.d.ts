import type { TeamModeConfig } from "../../../config/schema/team-mode";
import { loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store/store";
import type { Message, RuntimeState } from "@oh-my-opencode/team-core/types";
export type TeamRuntimeDetails = {
    teamRunId: string;
    isLead: boolean;
    senderName: string;
    activeMembers: string[];
};
export type TeamSendMessageDispatchTiming = {
    readonly postDispatchHoldMs?: number;
    readonly queueRetryMs?: number;
    readonly fallbackWakeSettleMs?: number;
};
export type TeamSendMessageToolDeps = {
    loadRuntimeState: typeof loadRuntimeState;
    liveDeliverySettleMs?: number;
    dispatchTiming?: TeamSendMessageDispatchTiming;
};
export declare const defaultTeamSendMessageToolDeps: TeamSendMessageToolDeps;
type RuntimeMember = RuntimeState["members"][number];
export declare function shouldReserveRecipientMailbox(member: RuntimeMember, message: Message, senderName: string): boolean;
export declare function resolveTeamRuntimeDetails(teamRunId: string, sessionID: string, config: TeamModeConfig, deps: TeamSendMessageToolDeps): Promise<TeamRuntimeDetails>;
export {};
