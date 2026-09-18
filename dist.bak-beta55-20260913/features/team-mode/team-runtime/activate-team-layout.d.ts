import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { TmuxSessionManager } from "../../tmux-subagent/manager";
import type { RuntimeState } from "../types";
export declare function activateTeamLayout(runtimeState: RuntimeState, config: TeamModeConfig, projectRoot: string, tmuxMgr?: TmuxSessionManager): Promise<boolean>;
