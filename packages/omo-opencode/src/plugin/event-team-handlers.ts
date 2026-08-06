import { createTeamIdleWakeHint } from "../hooks/team-session-events/team-idle-wake-hint";
import { createTeamLeadOrphanHandler } from "../hooks/team-session-events/team-lead-orphan-handler";
import { createTeamMemberErrorHandler } from "../hooks/team-session-events/team-member-error-handler";
import { createTeamMemberStatusHandler } from "../hooks/team-session-events/team-member-status-handler";
import { buildTeamIdleWakeHintClient } from "./build-team-idle-wake-hint-client";
import type { OhMyOpenCodeConfig } from "../config";
import type { Managers } from "../create-managers";
import type { PluginEventContext } from "./event-types";

export function createEventTeamHandlers(args: {
  pluginConfig: OhMyOpenCodeConfig;
  pluginContext: PluginEventContext;
  managers: Managers;
}) {
  const teamModeConfig = args.pluginConfig.team_mode?.enabled ? args.pluginConfig.team_mode : undefined;
  const teamLeadOrphanHandler = teamModeConfig
    ? createTeamLeadOrphanHandler(teamModeConfig, args.managers.tmuxSessionManager, args.managers.backgroundManager)
    : undefined;
  const teamMemberErrorHandler = teamModeConfig
    ? createTeamMemberErrorHandler(teamModeConfig, { client: args.pluginContext.client })
    : undefined;
  const teamMemberStatusHandler = teamModeConfig
    ? createTeamMemberStatusHandler(teamModeConfig)
    : undefined;
  const teamIdleWakeHint = teamModeConfig
    ? createTeamIdleWakeHint({
        directory: args.pluginContext.directory,
        client: buildTeamIdleWakeHintClient(args.pluginContext.client),
      }, teamModeConfig)
    : undefined;

  return {
    teamIdleWakeHint,
    teamLeadOrphanHandler,
    teamMemberErrorHandler,
    teamMemberStatusHandler,
  };
}
