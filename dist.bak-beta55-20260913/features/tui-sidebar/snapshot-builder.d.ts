import type { TuiRuntimeSnapshot } from "./snapshot-schema";
import type { BackgroundTaskSnapshot } from "../background-agent/types";
export type TuiMirrorClient = {
    readonly session: {
        readonly status: () => Promise<unknown>;
        readonly messages: (input: {
            readonly path: {
                readonly id: string;
            };
        }) => Promise<unknown>;
    };
};
export type SessionStatusRow = {
    readonly type: string;
};
export type SessionStatusMap = Record<string, SessionStatusRow>;
export type TuiBackgroundSnapshotProvider = {
    readonly getTasksSnapshot: () => readonly BackgroundTaskSnapshot[];
};
export type SessionAgentResolver = (sessionID: string, client: TuiMirrorClient) => Promise<string | null>;
export type BuildTuiRuntimeSnapshotInput = {
    readonly client: TuiMirrorClient;
    readonly projectDir: string;
    readonly backgroundManager: TuiBackgroundSnapshotProvider;
    readonly getStatuses?: () => Promise<SessionStatusMap>;
    readonly sessionAgentResolver?: SessionAgentResolver;
};
export declare function buildTuiRuntimeSnapshot(input: BuildTuiRuntimeSnapshotInput): Promise<TuiRuntimeSnapshot>;
