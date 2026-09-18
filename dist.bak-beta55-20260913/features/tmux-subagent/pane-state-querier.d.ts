import type { WindowState } from "./types";
import { getTmuxPath } from "../../tools/interactive-bash/tmux-path-resolver";
import { log } from "../../shared";
import type { TmuxCommandResult } from "../../shared/tmux";
type QueryWindowStateDeps = {
    getTmuxPath: typeof getTmuxPath;
    runTmuxCommand: (tmuxPath: string, args: string[]) => Promise<TmuxCommandResult>;
    log: typeof log;
};
export declare function queryWindowStateWithDeps(sourcePaneId: string, deps: QueryWindowStateDeps): Promise<WindowState | null>;
export declare function queryWindowState(sourcePaneId: string): Promise<WindowState | null>;
export {};
