import { type ToolDefinition } from "@opencode-ai/plugin";
import type { MonitorManager } from "../../features/monitor";
export interface MonitorStopArgs {
    monitor_id: string;
}
export type MonitorStopResult = {
    status: "stopped";
    monitor_id: string;
} | {
    status: "already-stopped";
    monitor_id: string;
} | {
    status: "denied";
    monitor_id: string;
};
export declare function createMonitorStop(manager: MonitorManager, _ctx?: unknown): ToolDefinition;
