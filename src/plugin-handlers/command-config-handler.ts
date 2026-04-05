import type { OhMyOpenCodeConfig } from "../config";
import { getAgentListDisplayName } from "../shared/agent-display-names";
import {
  loadUserCommands,
  loadProjectCommands,
  loadOpencodeGlobalCommands,
  loadOpencodeProjectCommands,
} from "../features/claude-code-command-loader";
import { loadBuiltinCommands } from "../features/builtin-commands";
import {
  discoverConfigSourceSkills,
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

export async function applyCommandConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  ctx: { directory: string };
  pluginComponents: PluginComponents;
}): Promise<void> {
  const builtinCommands = loadBuiltinCommands(params.pluginConfig.disabled_commands, {
    useRegisteredAgents: true,
  });
  const systemCommands = (params.config.command as Record<string, unknown>) ?? {};

  const includeClaudeCommands = params.pluginConfig.claude_code?.commands ?? true;
  const includeClaudeSkills = params.pluginConfig.claude_code?.skills ?? true;

  const externalSkillPlugin = detectExternalSkillPlugin(params.ctx.directory);
  if (includeClaudeSkills && externalSkillPlugin.detected) {
    log(getSkillPluginConflictWarning(externalSkillPlugin.pluginName!));
  }

  const [
    configSourceSkills,
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
    ...builtinCommands,
    ...skillsToCommandDefinitionRecord(configSourceSkills),
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
      cmd.agent = getAgentListDisplayName(cmd.agent);
    }
  }
}
