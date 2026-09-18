import type { TmuxPaneInfo } from "./types";
type ParsedPaneState = {
    windowWidth: number;
    windowHeight: number;
    windowActive: boolean;
    sessionAttached: boolean;
    panes: TmuxPaneInfo[];
};
export declare function parsePaneStateOutput(stdout: string): ParsedPaneState | null;
export {};
