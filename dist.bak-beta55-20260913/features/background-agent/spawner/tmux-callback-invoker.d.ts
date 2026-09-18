import type { OnSubagentSessionCreated } from "../constants";
export interface TmuxCallbackInvocation {
    callback: OnSubagentSessionCreated | undefined;
    tmuxEnabled: boolean;
    suppress: boolean;
    sessionID: string;
    parentID: string;
    title: string;
    log: (message: string, data?: unknown) => void;
}
export declare function invokeTmuxSessionCreatedCallback(invocation: TmuxCallbackInvocation): void;
