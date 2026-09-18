/**
 * Bash-permission feasibility spike, 2026-06-15:
 * OpenCode exposes Bash permission enforcement to plugin tools through
 * ToolContext.ask({ permission: "bash", patterns: [command], ... }). The
 * plugin and SDK surfaces do not expose a pure dry-run evaluator that returns
 * the exact Bash decision for an arbitrary command string: tool.execute.before
 * hooks only see the active tool call and mutable args, permission.ask is a
 * hook for an already-created permission request, and the SDK can only reply to
 * existing permission requests. Therefore this gate uses an injected
 * bashPermissionAsk callback when a caller has ToolContext.ask available; if
 * that callback is absent, it fails closed to monitor.allowed_commands.
 */
import type { MonitorConfig as SchemaMonitorConfig } from "../../config/schema/monitor";
export type MonitorConfig = Pick<SchemaMonitorConfig, "enabled" | "allowed_commands"> & Partial<SchemaMonitorConfig>;
export type MonitorPermissionVia = "bash-equivalent" | "allowlist" | "feature-disabled";
export type MonitorPermissionResult = {
    allowed: boolean;
    reason: string;
    via: MonitorPermissionVia;
};
export type BashPermissionAskInput = {
    permission: "bash";
    patterns: string[];
    always: string[];
    metadata: {
        command: string;
    };
};
export type MonitorPermissionContext = {
    config: MonitorConfig;
    bashPermissionAsk?: (input: BashPermissionAskInput) => Promise<void>;
};
export declare function checkMonitorCommandPermission(command: string, ctx: MonitorPermissionContext): Promise<MonitorPermissionResult>;
