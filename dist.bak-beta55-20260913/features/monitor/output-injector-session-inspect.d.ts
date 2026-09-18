import type { DispatchedMonitorOutput, MonitorPromptClient, MonitorSessionMessage } from "./output-injector-types";
export declare function loadMonitorSessionMessages(client: MonitorPromptClient, directory: string, sessionID: string): Promise<MonitorSessionMessage[]>;
export declare function getMessageRole(message: MonitorSessionMessage): string | undefined;
export declare function getMessageCreatedAt(message: MonitorSessionMessage): number | undefined;
export declare function isUserMessageInProgress(client: MonitorPromptClient, directory: string, sessionID: string, now: number, userMessageInProgressWindowMs: number): Promise<boolean>;
export declare function monitorMessageHasOutput(message: MonitorSessionMessage): boolean;
export declare function monitorMessageContainsBatch(message: MonitorSessionMessage, output: DispatchedMonitorOutput): boolean;
export declare function hasAcceptedMessageAfterDispatchedMonitorOutput(client: MonitorPromptClient, directory: string, sessionID: string, output: DispatchedMonitorOutput, acceptedMessageSkewMs: number): Promise<boolean>;
export declare function latestAssistantTurnBlocksMonitorOutput(client: MonitorPromptClient, directory: string, sessionID: string): Promise<boolean>;
