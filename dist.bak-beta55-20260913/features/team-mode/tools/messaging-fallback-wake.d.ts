import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { RuntimeState } from "@oh-my-opencode/team-core/types";
import type { LiveDeliveryClient } from "./messaging-live-delivery-client";
import type { TeamSendMessageDispatchTiming } from "./messaging-runtime";
type RuntimeMember = RuntimeState["members"][number];
export declare function enqueueFallbackMailboxWake(input: {
    readonly client: LiveDeliveryClient;
    readonly recipientMember: RuntimeMember;
    readonly recipientSessionId: string;
    readonly directory: string;
    readonly teamRunId: string;
    readonly recipientName: string;
    readonly messageId: string;
    readonly config: TeamModeConfig;
    readonly dispatchTiming?: TeamSendMessageDispatchTiming;
}): Promise<void>;
export {};
