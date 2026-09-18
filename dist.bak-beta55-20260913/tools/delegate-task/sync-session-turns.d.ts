import type { SessionMessage } from "./executor-types";
export declare function isSessionComplete(messages: readonly SessionMessage[]): boolean;
export declare function getTerminalSessionError(messages: readonly SessionMessage[]): string | null;
