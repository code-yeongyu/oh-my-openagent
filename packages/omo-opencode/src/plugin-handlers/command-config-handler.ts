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
import { resolveActiveBuiltinSkills } from "@oh-my-opencode/skills-loader-core/builtin-skills";
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
import {
  fingerprintGlobalSources,
  getProcessConfigCacheEntry,
  setProcessConfigCacheEntry,
} from "../shared/process-config-cache";

/**
 * Directory-independent command sources (local fix 28, first-message-drop
 * F5c): builtin commands, builtin skills, user commands/skills, global agent
 * skills and OpenCode global commands/skills are identical for every folder,
 * but they used to be re-loaded from disk on every folder rebuild. Project
 * sources stay per-folder.
 *
 * The entry is keyed by the config flags, the registered agent names and a
 * content fingerprint of the user-level source directories (local fix 31), so
 * adding, removing or editing a user command or skill reloads them.
 */
type GlobalCommandSources = {
  builtinSkillCommands: Record<string, unknown>;
  builtinCommands: Record<string, unknown>;
  userCommands: Record<string, unknown>;
  userSkills: Record<string, unknown>;
  globalAgentsSkills: Record<string, unknown>;
  opencodeGlobalCommands: Record<string, unknown>;
  opencodeGlobalSkills: Record<string, unknown>;
};

function shallowCopyCommandRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).map(([name, command]) => [name, { ...command }]),
  );
}

function buildGlobalCommandSourcesCacheKey(params: {
  pluginConfig: OhMyOpenCodeConfig;
  disabledSkills: ReadonlySet<string>;
  includeClaudeCommands: boolean;
  includeClaudeSkills: boolean;
  agentNames: ReadonlyArray<string>;
  sourcesFingerprint: string;
}): string {
  return JSON.stringify({
    sources: params.sourcesFingerprint,
    agentNames: params.agentNames,
    disabledCommands: params.pluginConfig.disabled_commands ?? [],
    teamMode: params.pluginConfig.team_mode?.enabled ?? false,
    browserProvider: params.pluginConfig.browser_automation_engine?.provider ?? "playwright",
    disabledSkills: [...params.disabledSkills].sort(),
    includeClaudeCommands: params.includeClaudeCommands,
    includeClaudeSkills: params.includeClaudeSkills,
    systemMcpNames: getSystemMcpServerNames(),
  });
}

async function loadGlobalCommandSources(params: {
  pluginConfig: OhMyOpenCodeConfig;
  disabledSkills: Set<string>;
  includeClaudeCommands: boolean;
  includeClaudeSkills: boolean;
  agentNames: ReadonlyArray<string>;
  sourcesFingerprint: string | undefined;
}): Promise<GlobalCommandSources> {
  // Source directories too large to fingerprint are loaded every time.
  const sourcesFingerprint = params.sourcesFingerprint;
  const cacheKey = sourcesFingerprint === undefined
    ? undefined
    : buildGlobalCommandSourcesCacheKey({ ...params, sourcesFingerprint });
  const cached = cacheKey === undefined ? undefined : getProcessConfigCacheEntry("globalCommandSources");
  if (cached && cached.key === cacheKey) {
    log("[command-config] reusing cached global command sources (process-level)");
    const value = cached.value as GlobalCommandSources;
    return {
      builtinSkillCommands: shallowCopyCommandRecord(value.builtinSkillCommands),
      builtinCommands: shallowCopyCommandRecord(value.builtinCommands),
      userCommands: shallowCopyCommandRecord(value.userCommands),
      userSkills: shallowCopyCommandRecord(value.userSkills),
      globalAgentsSkills: shallowCopyCommandRecord(value.globalAgentsSkills),
      opencodeGlobalCommands: shallowCopyCommandRecord(value.opencodeGlobalCommands),
      opencodeGlobalSkills: shallowCopyCommandRecord(value.opencodeGlobalSkills),
    };
  }

  const builtinCommands = loadBuiltinCommands(params.pluginConfig.disabled_commands, {
    useRegisteredAgents: true,
    teamModeEnabled: params.pluginConfig.team_mode?.enabled ?? false,
  });
  const builtinSkillCommands = builtinSkillsToCommandDefinitionRecord(
    resolveActiveBuiltinSkills({
      browserProvider: params.pluginConfig.browser_automation_engine?.provider ?? "playwright",
      disabledSkills: params.disabledSkills,
      teamModeEnabled: params.pluginConfig.team_mode?.enabled ?? false,
      systemMcpNames: getSystemMcpServerNames(),
    }),
  );
  for (const disabledCommand of params.pluginConfig.disabled_commands ?? []) {
    delete builtinSkillCommands[disabledCommand];
  }

  const [userCommands, userSkills, globalAgentsSkills, opencodeGlobalCommands, opencodeGlobalSkills] =
    await Promise.all([
      params.includeClaudeCommands ? loadUserCommands() : Promise.resolve({}),
      params.includeClaudeSkills ? loadUserSkills() : Promise.resolve({}),
      params.includeClaudeSkills ? loadGlobalAgentsSkills() : Promise.resolve({}),
      loadOpencodeGlobalCommands(),
      loadOpencodeGlobalSkills(),
    ]);

  const sources: GlobalCommandSources = {
    builtinSkillCommands,
    builtinCommands,
    userCommands,
    userSkills,
    globalAgentsSkills,
    opencodeGlobalCommands,
    opencodeGlobalSkills,
  };
  if (cacheKey !== undefined) {
    setProcessConfigCacheEntry("globalCommandSources", { key: cacheKey, value: sources });
  }
  return sources;
}

export async function applyCommandConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  ctx: { directory: string };
  pluginComponents: PluginComponents;
  globalSources?: { fingerprint: string | undefined };
}): Promise<void> {
  const disabledSkills = collectDisabledSkillAliases(params.pluginConfig);

  const includeClaudeCommands = params.pluginConfig.claude_code?.commands ?? true;
  const includeClaudeSkills = params.pluginConfig.claude_code?.skills ?? true;

  const externalSkillPlugin = detectExternalSkillPlugin(params.ctx.directory);
  if (includeClaudeSkills && externalSkillPlugin.detected && externalSkillPlugin.pluginName) {
    log(getSkillPluginConflictWarning(externalSkillPlugin.pluginName));
  }

  const [
    globalSources,
    configSourceSkills,
    hostConfigSkills,
    projectCommands,
    opencodeProjectCommands,
    projectSkills,
    projectAgentsSkills,
    opencodeProjectSkills,
  ] = await Promise.all([
    loadGlobalCommandSources({
      pluginConfig: params.pluginConfig,
      disabledSkills: disabledSkills as Set<string>,
      includeClaudeCommands,
      includeClaudeSkills,
      agentNames: Object.keys((params.config.agent as Record<string, unknown> | undefined) ?? {}).sort(),
      sourcesFingerprint: params.globalSources ? params.globalSources.fingerprint : fingerprintGlobalSources(),
    }),
    discoverConfigSourceSkills({
      config: params.pluginConfig.skills,
      configDir: params.ctx.directory,
    }),
    discoverConfigSourceSkills({
      config: adaptHostSkillConfig(params.config.skills),
      configDir: params.ctx.directory,
    }),
    includeClaudeCommands ? loadProjectCommands(params.ctx.directory) : Promise.resolve({}),
    loadOpencodeProjectCommands(params.ctx.directory),
    includeClaudeSkills ? loadProjectSkills(params.ctx.directory) : Promise.resolve({}),
    includeClaudeSkills ? loadProjectAgentsSkills(params.ctx.directory) : Promise.resolve({}),
    loadOpencodeProjectSkills(params.ctx.directory),
  ]);

  const {
    builtinSkillCommands,
    builtinCommands,
    userCommands,
    userSkills,
    globalAgentsSkills,
    opencodeGlobalCommands,
    opencodeGlobalSkills,
  } = globalSources;
  const systemCommands = (params.config.command as Record<string, unknown>) ?? {};

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

  remapCommandAgentFields(
    params.config.command as Record<string, Record<string, unknown>>,
    params.pluginConfig.agents,
  );
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

function remapCommandAgentFields(
  commands: Record<string, Record<string, unknown>>,
  overrides?: Record<string, { displayName?: string } | undefined>,
): void {
  for (const cmd of Object.values(commands)) {
    if (cmd?.agent && typeof cmd.agent === "string") {
      cmd.agent = getAgentListDisplayName(getAgentConfigKey(cmd.agent), overrides);
    }
  }
}
