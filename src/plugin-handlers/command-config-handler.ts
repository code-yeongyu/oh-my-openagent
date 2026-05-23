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
import { adaptHostSkillConfig } from "../shared/host-skill-config";
import type { LoadedSkill } from "../features/opencode-skill-loader/types";

export async function applyCommandConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  ctx: { directory: string };
  pluginComponents: PluginComponents;
  /**
   * Mutable reference to the live `skillContext.mergedSkills` array used by the
   * `skill` tool. When other OpenCode plugins (e.g. `superpowers`) push their
   * skill directories onto `config.skills.paths` from their own `config` hook,
   * those skills only land in our config snapshot — never in `skillContext`,
   * which is frozen at plugin init before host config is available. Without
   * this ref, the `skill` tool can describe (via `loadedSkillToInfo`) but not
   * `execute` skills owned by sibling plugins, producing the
   * "Skill or command not found" failure tracked in #4302 / #4250.
   *
   * The ref is `undefined` until `createTools()` has populated the merged-skill
   * array; the helper is a no-op while it stays undefined.
   */
  mergedSkillsRef?: LoadedSkill[];
}): Promise<void> {
  const builtinCommands = loadBuiltinCommands(params.pluginConfig.disabled_commands, {
    useRegisteredAgents: true,
    teamModeEnabled: params.pluginConfig.team_mode?.enabled ?? false,
  });
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

  // Hand the OpenCode-host-discovered skills back to the live skillContext so
  // they become loadable by the runtime `skill` tool, not just renderable as
  // slash-style commands. See the doc on `mergedSkillsRef` in the signature
  // above for the precise failure this addresses (#4302, #4250).
  pushUniqueSkillsByName(params.mergedSkillsRef, hostConfigSkills);

  remapCommandAgentFields(params.config.command as Record<string, Record<string, unknown>>);
}

function pushUniqueSkillsByName(
  target: LoadedSkill[] | undefined,
  candidates: LoadedSkill[],
): void {
  if (!target || candidates.length === 0) return;
  const knownNames = new Set(target.map((skill) => skill.name));
  for (const skill of candidates) {
    if (knownNames.has(skill.name)) continue;
    target.push(skill);
    knownNames.add(skill.name);
  }
}

function remapCommandAgentFields(commands: Record<string, Record<string, unknown>>): void {
  for (const cmd of Object.values(commands)) {
    if (cmd?.agent && typeof cmd.agent === "string") {
      cmd.agent = getAgentListDisplayName(getAgentConfigKey(cmd.agent));
    }
  }
}
