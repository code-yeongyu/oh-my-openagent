import type { OhMyOpenCodeConfig } from "../config";
import type { Managers } from "../create-managers";
import type { PluginEventContext } from "./event-types";
export declare function createEventTeamHandlers(args: {
    pluginConfig: OhMyOpenCodeConfig;
    pluginContext: PluginEventContext;
    managers: Managers;
}): {
    teamIdleWakeHint: import("../hooks/team-session-events/team-idle-wake-hint").HookImpl | undefined;
    teamLeadOrphanHandler: import("../hooks/team-session-events/team-lead-orphan-handler").HookImpl | undefined;
    teamMemberErrorHandler: import("../hooks/team-session-events/team-member-error-handler").HookImpl | undefined;
    teamMemberStatusHandler: import("../hooks/team-session-events/team-member-status-handler").HookImpl | undefined;
};
