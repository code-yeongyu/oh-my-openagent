import type { AgentsState, ConfigState, JobBoardState, LoopState, RosterState, SidebarView } from "./state-types";
export type ComputeViewSections = {
    readonly config: ConfigState;
    readonly roster: RosterState;
    readonly agents: AgentsState;
    readonly jobs: JobBoardState;
    readonly loop: LoopState;
};
export declare function computeView(sections: ComputeViewSections): SidebarView;
export declare function viewKey(view: SidebarView): string;
