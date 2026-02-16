import type { OhMyOpenCodeConfig } from "../config";
import {
  loadUserCommands,
  loadProjectCommands,
  loadOpencodeGlobalCommands,
  loadOpencodeProjectCommands,
} from "../features/claude-code-command-loader";
import { loadBuiltinCommands } from "../features/builtin-commands";
import {
  discoverConfigSourceSkills,
  loadUserSkills,
  loadProjectSkills,
  loadOpencodeGlobalSkills,
  loadOpencodeProjectSkills,
  skillsToCommandDefinitionRecord,
} from "../features/opencode-skill-loader";
import type { PluginComponents } from "./plugin-components-loader";

export async function applyCommandConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  ctx: { directory: string };
  pluginComponents: PluginComponents;
}): Promise<void> {
  const builtinCommands = loadBuiltinCommands(params.pluginConfig.disabled_commands);
  const systemCommands = (params.config.command as Record<string, unknown>) ?? {};

  const includeClaudeCommands = params.pluginConfig.claude_code?.commands ?? true;
  const includeClaudeSkills = params.pluginConfig.claude_code?.skills ?? true;

  const [
    configSourceSkills,
    userCommands,
    projectCommands,
    opencodeGlobalCommands,
    opencodeProjectCommands,
    userSkills,
    projectSkills,
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
    includeClaudeSkills ? loadProjectSkills(params.ctx.directory) : Promise.resolve({}),
    loadOpencodeGlobalSkills(),
    loadOpencodeProjectSkills(params.ctx.directory),
  ]);

  params.config.command = {
    ...builtinCommands,
    ...skillsToCommandDefinitionRecord(configSourceSkills),
    ...userCommands,
    ...userSkills,
    ...opencodeGlobalCommands,
    ...opencodeGlobalSkills,
    ...systemCommands,
    ...projectCommands,
    ...projectSkills,
    ...opencodeProjectCommands,
    ...opencodeProjectSkills,
    ...params.pluginComponents.commands,
    ...params.pluginComponents.skills,
  };
}
