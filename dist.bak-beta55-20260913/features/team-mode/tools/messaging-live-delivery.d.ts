import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { Message } from "@oh-my-opencode/team-core/types";
import type { LiveDeliveryClient } from "./messaging-live-delivery-client";
import type { TeamSendMessageToolDeps } from "./messaging-runtime";
export type { LiveDeliveryClient } from "./messaging-live-delivery-client";
export declare function deliverLive(client: LiveDeliveryClient, message: Message, teamRunId: string, deliveredTo: readonly string[], config: TeamModeConfig, directory: string, deps: TeamSendMessageToolDeps): Promise<void>;
