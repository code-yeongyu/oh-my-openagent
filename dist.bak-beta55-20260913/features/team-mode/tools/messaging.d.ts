import { type ToolDefinition } from "@opencode-ai/plugin/tool";
import type { TeamModeConfig } from "../../../config/schema/team-mode";
import { type LiveDeliveryClient } from "./messaging-live-delivery";
import { type TeamSendMessageToolDeps } from "./messaging-runtime";
export type { LiveDeliveryClient } from "./messaging-live-delivery";
export type { TeamSendMessageToolDeps } from "./messaging-runtime";
export declare function createTeamSendMessageTool(config: TeamModeConfig, client: LiveDeliveryClient, deps?: TeamSendMessageToolDeps): ToolDefinition;
