import type { LoadedSkill } from "../features/opencode-skill-loader";
import {
  deduplicateSkillsByName,
  discoverConfigSourceSkills,
  discoverGlobalAgentsSkills,
  discoverOpencodeGlobalSkills,
  discoverOpencodeProjectSkills,
  discoverProjectAgentsSkills,
  discoverProjectClaudeSkills,
  discoverUserClaudeSkills,
} from "../features/opencode-skill-loader";
import { adaptHostSkillConfig } from "../shared/host-skill-config";
import type { ApplyAgentConfigParams } from "./agent-config-types";

export async function discoverAgentSkills(
  params: Pick<ApplyAgentConfigParams, "config" | "pluginConfig" | "ctx">,
): Promise<LoadedSkill[]> {
  const includeClaudeSkillsForAwareness = params.pluginConfig.claude_code?.skills ?? true;
  const hostSkillConfig = adaptHostSkillConfig(params.config.skills);
  const [
    discoveredConfigSourceSkills,
    discoveredHostConfigSkills,
    discoveredUserSkills,
    discoveredProjectSkills,
    discoveredProjectAgentsSkills,
    discoveredOpencodeGlobalSkills,
    discoveredOpencodeProjectSkills,
    discoveredGlobalAgentsSkills,
  ] = await Promise.all([
    discoverConfigSourceSkills({
      config: params.pluginConfig.skills,
      configDir: params.ctx.directory,
    }),
    discoverConfigSourceSkills({
      config: hostSkillConfig,
      configDir: params.ctx.directory,
    }),
    includeClaudeSkillsForAwareness ? discoverUserClaudeSkills() : Promise.resolve([]),
    includeClaudeSkillsForAwareness
      ? discoverProjectClaudeSkills(params.ctx.directory)
      : Promise.resolve([]),
    includeClaudeSkillsForAwareness
      ? discoverProjectAgentsSkills(params.ctx.directory)
      : Promise.resolve([]),
    discoverOpencodeGlobalSkills(),
    discoverOpencodeProjectSkills(params.ctx.directory),
    includeClaudeSkillsForAwareness ? discoverGlobalAgentsSkills() : Promise.resolve([]),
  ]);

  return deduplicateSkillsByName([
    ...discoveredConfigSourceSkills,
    ...discoveredHostConfigSkills,
    ...discoveredOpencodeProjectSkills,
    ...discoveredProjectSkills,
    ...discoveredProjectAgentsSkills,
    ...discoveredOpencodeGlobalSkills,
    ...discoveredUserSkills,
    ...discoveredGlobalAgentsSkills,
  ]);
}
