import { type ToolDefinition } from "@opencode-ai/plugin/tool";
import type { MonitorManager } from "../../features/monitor";
interface MonitorListContext {
    sessionID: string;
}
export declare function createMonitorList(manager: MonitorManager, ctx: MonitorListContext): ToolDefinition;
export {};
