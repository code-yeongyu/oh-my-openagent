import type { OhMyOpenCodeConfig } from "../config";
import { loadBuiltinCommands } from "../features/builtin-commands";
import { createBuiltinSkills } from "../features/builtin-skills";
import {
  loadOpencodeGlobalCommands,
  loadOpencodeProjectCommands,
  loadProjectCommands,
  loadUserCommands,
} from "../features/claude-code-command-loader";
import {
  discoverConfigSourceSkills,
  loadGlobalAgentsSkills,
  loadOpencodeGlobalSkills,
  loadOpencodeProjectSkills,
  loadProjectAgentsSkills,
  loadProjectSkills,
  loadUserSkills,
  skillsToCommandDefinitionRecord,
} from "../features/opencode-skill-loader";
import { builtinToLoadedSkill } from "../features/opencode-skill-loader/merger/builtin-skill-converter";
import {
  detectExternalSkillPlugin,
  getSkillPluginConflictWarning,
  log,
} from "../shared";
import {
  getAgentConfigKey,
  getAgentListDisplayName,
} from "../shared/agent-display-names";
import { adaptHostSkillConfig } from "../shared/host-skill-config";
import type { PluginComponents } from "./plugin-components-loader";

export async function applyCommandConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  ctx: { directory: string };
  pluginComponents: PluginComponents;
}): Promise<void> {
  const builtinCommands = loadBuiltinCommands(params.pluginConfig.disabled_commands, {
    useRegisteredAgents: true,
    teamModeEnabled: params.pluginConfig.team_mode?.enabled ?? false,
  });
  const builtinSkillCommands = skillsToCommandDefinitionRecord(
    createBuiltinSkills({
      browserProvider: params.pluginConfig.browser_automation_engine?.provider ?? "playwright",
      disabledSkills: new Set(params.pluginConfig.disabled_skills ?? []),
      teamModeEnabled: params.pluginConfig.team_mode?.enabled ?? false,
    }).map(builtinToLoadedSkill),
  );
  const systemCommands = (params.config.command as Record<string, unknown>) ?? {};

  const includeClaudeCommands = params.pluginConfig.claude_code?.commands ?? true;
  const includeClaudeSkills = params.pluginConfig.claude_code?.skills ?? true;

  const externalSkillPlugin = detectExternalSkillPlugin(params.ctx.directory);
  if (includeClaudeSkills && externalSkillPlugin.detected && externalSkillPlugin.pluginName) {
    log(getSkillPluginConflictWarning(externalSkillPlugin.pluginName));
  }

  const hostSkillConfig = adaptHostSkillConfig(params.config.skills);
  const [
    configSourceSkills,
    hostConfigSkills,
    userCommands,
    projectCommands,
    opencodeGlobalCommands,
    opencodeProjectCommands,
    userSkills,
    globalAgentsSkills,
    projectSkills,
    projectAgentsSkills,
    opencodeGlobalSkills,
    opencodeProjectSkills,
  ] = await Promise.all([
    discoverConfigSourceSkills({
      config: params.pluginConfig.skills,
      configDir: params.ctx.directory,
    }),
    discoverConfigSourceSkills({
      config: hostSkillConfig,
      configDir: params.ctx.directory,
    }),
    includeClaudeCommands ? loadUserCommands() : Promise.resolve({}),
    includeClaudeCommands ? loadProjectCommands(params.ctx.directory) : Promise.resolve({}),
    loadOpencodeGlobalCommands(),
    loadOpencodeProjectCommands(params.ctx.directory),
    includeClaudeSkills ? loadUserSkills() : Promise.resolve({}),
    includeClaudeSkills ? loadGlobalAgentsSkills() : Promise.resolve({}),
    includeClaudeSkills ? loadProjectSkills(params.ctx.directory) : Promise.resolve({}),
    includeClaudeSkills ? loadProjectAgentsSkills(params.ctx.directory) : Promise.resolve({}),
    loadOpencodeGlobalSkills(),
    loadOpencodeProjectSkills(params.ctx.directory),
  ]);

  params.config.command = {
    ...builtinSkillCommands,
    ...builtinCommands,
    ...skillsToCommandDefinitionRecord(configSourceSkills),
    ...skillsToCommandDefinitionRecord(hostConfigSkills),
    ...userCommands,
    ...userSkills,
    ...globalAgentsSkills,
    ...opencodeGlobalCommands,
    ...opencodeGlobalSkills,
    ...systemCommands,
    ...projectCommands,
    ...projectSkills,
    ...projectAgentsSkills,
    ...opencodeProjectCommands,
    ...opencodeProjectSkills,
    ...params.pluginComponents.commands,
    ...params.pluginComponents.skills,
  };

  remapCommandAgentFields(params.config.command as Record<string, Record<string, unknown>>);
}

function remapCommandAgentFields(commands: Record<string, Record<string, unknown>>): void {
  for (const cmd of Object.values(commands)) {
    if (cmd?.agent && typeof cmd.agent === "string") {
      cmd.agent = getAgentListDisplayName(getAgentConfigKey(cmd.agent));
    }
  }
}
