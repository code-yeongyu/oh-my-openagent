import type { MonitorManager } from "../../features/monitor/types";
type TransformPart = {
    type: string;
    text?: string;
    synthetic?: boolean;
    [key: string]: unknown;
};
type TransformMessageInfo = {
    role: string;
    sessionID?: string;
    [key: string]: unknown;
};
type MessageWithParts = {
    info: TransformMessageInfo;
    parts: TransformPart[];
};
type MonitorStatusInjectorInput = {
    sessionID?: string;
    [key: string]: unknown;
};
type MonitorStatusInjectorOutput = {
    messages: MessageWithParts[];
};
export type MonitorStatusInjectorHook = {
    "experimental.chat.messages.transform"?: (input: MonitorStatusInjectorInput, output: MonitorStatusInjectorOutput) => Promise<void>;
};
export declare function createMonitorStatusInjectorHook(monitorManager: MonitorManager, config: {
    enabled: boolean;
}): MonitorStatusInjectorHook;
export {};
