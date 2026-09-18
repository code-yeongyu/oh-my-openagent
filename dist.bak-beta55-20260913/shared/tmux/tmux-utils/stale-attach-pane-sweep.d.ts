export type TmuxAttachPane = {
    readonly paneId: string;
    readonly title: string;
    readonly attachServerUrl: string;
    readonly commandLine: string;
};
export type SweepAttachPaneDeps = {
    readonly isInsideTmux: () => boolean;
    readonly getTmuxPath: () => Promise<string | null | undefined>;
    readonly listCandidatePanes: (tmux: string) => Promise<readonly TmuxAttachPane[]>;
    readonly isServerRunning: (serverUrl: string) => Promise<boolean>;
    readonly closePane: (paneId: string) => Promise<boolean>;
    readonly log: (message: string, payload?: unknown) => void;
};
export declare function sweepStaleOmoAttachPanesWith(deps: SweepAttachPaneDeps): Promise<number>;
export declare function sweepStaleOmoAttachPanes(): Promise<number>;
