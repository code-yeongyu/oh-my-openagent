import type { OhMyOpenCodeConfig } from "../config";
import {
  getAgentConfigKey,
  getAgentListDisplayName,
} from "../shared/agent-display-names";
import {
  loadUserCommands,
  loadProjectCommands,
  loadOpencodeGlobalCommands,
  loadOpencodeProjectCommands,
} from "../features/claude-code-command-loader";
import { loadBuiltinCommands } from "../features/builtin-commands";
import { resolveActiveBuiltinSkills } from "../features/builtin-skills";
import { getSystemMcpServerNames } from "../features/claude-code-mcp-loader";
import {
  builtinSkillsToCommandDefinitionRecord,
  discoverConfigSourceSkills,
  isDisabledSkillAlias,
  isDisabledSkillName,
  loadGlobalAgentsSkills,
  loadProjectAgentsSkills,
  loadUserSkills,
  loadProjectSkills,
  loadOpencodeGlobalSkills,
  loadOpencodeProjectSkills,
  skillsToCommandDefinitionRecord,
} from "../features/opencode-skill-loader";
import {
  detectExternalSkillPlugin,
  getSkillPluginConflictWarning,
  log,
} from "../shared";
import type { PluginComponents } from "./plugin-components-loader";
import { adaptHostSkillConfig } from "../shared/host-skill-config";
import { collectDisabledSkillAliases } from "../plugin/skill-context";
import type { LoadedSkill } from "../features/opencode-skill-loader/types";

export async function applyCommandConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  ctx: { directory: string };
  pluginComponents: PluginComponents;
}): Promise<void> {
  const disabledSkills = collectDisabledSkillAliases(params.pluginConfig);
  const builtinCommands = loadBuiltinCommands(params.pluginConfig.disabled_commands, {
    useRegisteredAgents: true,
    teamModeEnabled: params.pluginConfig.team_mode?.enabled ?? false,
  });
  const builtinSkillCommands = builtinSkillsToCommandDefinitionRecord(
    resolveActiveBuiltinSkills({
      browserProvider: params.pluginConfig.browser_automation_engine?.provider ?? "playwright",
      disabledSkills,
      teamModeEnabled: params.pluginConfig.team_mode?.enabled ?? false,
      systemMcpNames: getSystemMcpServerNames(),
    }),
  );
  for (const disabledCommand of params.pluginConfig.disabled_commands ?? []) {
    delete builtinSkillCommands[disabledCommand];
  }
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
    ...skillsToCommandDefinitionRecord(filterDisabledLoadedSkills(configSourceSkills, disabledSkills)),
    ...skillsToCommandDefinitionRecord(filterDisabledLoadedSkills(hostConfigSkills, disabledSkills)),
    ...userCommands,
    ...filterDisabledSkillCommandRecord(userSkills, disabledSkills),
    ...filterDisabledSkillCommandRecord(globalAgentsSkills, disabledSkills),
    ...opencodeGlobalCommands,
    ...filterDisabledSkillCommandRecord(opencodeGlobalSkills, disabledSkills),
    ...systemCommands,
    ...projectCommands,
    ...filterDisabledSkillCommandRecord(projectSkills, disabledSkills),
    ...filterDisabledSkillCommandRecord(projectAgentsSkills, disabledSkills),
    ...opencodeProjectCommands,
    ...filterDisabledSkillCommandRecord(opencodeProjectSkills, disabledSkills),
    ...params.pluginComponents.commands,
    ...filterDisabledSkillCommandRecord(params.pluginComponents.skills, disabledSkills),
  };

  remapCommandAgentFields(params.config.command as Record<string, Record<string, unknown>>);
}

function filterDisabledLoadedSkills(
  skills: LoadedSkill[],
  disabledSkills: ReadonlySet<string>,
): LoadedSkill[] {
  if (disabledSkills.size === 0) return skills;
  return skills.filter((skill) => !isDisabledSkillAlias(skill, disabledSkills));
}

function filterDisabledSkillCommandRecord<T>(
  commands: Record<string, T>,
  disabledSkills: ReadonlySet<string>,
): Record<string, T> {
  if (disabledSkills.size === 0) return commands;

  const activeCommands: Record<string, T> = {};
  for (const [name, command] of Object.entries(commands)) {
    if (!isDisabledSkillName(name, disabledSkills)) {
      activeCommands[name] = command;
    }
  }
  return activeCommands;
}

function remapCommandAgentFields(commands: Record<string, Record<string, unknown>>): void {
  for (const cmd of Object.values(commands)) {
    if (cmd?.agent && typeof cmd.agent === "string") {
      cmd.agent = getAgentListDisplayName(getAgentConfigKey(cmd.agent));
    }
  }
}
