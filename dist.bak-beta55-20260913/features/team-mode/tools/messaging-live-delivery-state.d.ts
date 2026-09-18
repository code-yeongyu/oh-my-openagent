import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { RuntimeState } from "@oh-my-opencode/team-core/types";
import type { TeamSendMessageToolDeps } from "./messaging-runtime";
export declare function markLiveDeliveryPending(teamRunId: string, recipientName: string, messageId: string, config: TeamModeConfig): Promise<void>;
export declare function loadRuntimeStateForLiveDelivery(teamRunId: string, deliveredTo: readonly string[], messageId: string, config: TeamModeConfig, deps: TeamSendMessageToolDeps): Promise<RuntimeState | undefined>;
