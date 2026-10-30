import type { LoadedSkill } from "../features/opencode-skill-loader";
import {
  deduplicateSkillsByName,
  discoverConfigSourceSkills,
  getSkillSourceProvenance,
  readOpencodeConfigSkills,
  discoverGlobalAgentsSkills,
  discoverOpencodeGlobalSkills,
  discoverOpencodeProjectSkills,
  discoverProjectAgentsSkills,
  discoverProjectClaudeSkills,
  discoverUserClaudeSkills,
} from "../features/opencode-skill-loader";
import { adaptHostSkillConfig } from "../shared/host-skill-config";
import type { ApplyAgentConfigParams } from "./agent-config-types";
import { detectWorktreePath } from "@oh-my-opencode/skills-loader-core/shared/project-discovery-dirs";

export async function discoverAgentSkills(
  params: Pick<ApplyAgentConfigParams, "config" | "pluginConfig" | "ctx">,
): Promise<LoadedSkill[]> {
  const includeClaudeSkillsForAwareness = params.pluginConfig.claude_code?.skills ?? true;
  const hostSkillConfig = adaptHostSkillConfig(params.config.skills);
  const diskHostSkills = readOpencodeConfigSkills(params.ctx.directory);
  const sourceProvenance = getSkillSourceProvenance(params.pluginConfig.skills);
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
      userSources: diskHostSkills?.userPaths,
      projectSources: diskHostSkills?.projectPaths,
      provenance: { ...sourceProvenance, kind: "host", selectedRoot: params.ctx.directory, projectRoot: sourceProvenance?.projectRoot ?? detectWorktreePath(params.ctx.directory) ?? params.ctx.directory },
    }),
    includeClaudeSkillsForAwareness ? discoverUserClaudeSkills() : Promise.resolve([]),
    includeClaudeSkillsForAwareness
      ? discoverProjectClaudeSkills(params.ctx.directory, sourceProvenance)
      : Promise.resolve([]),
    includeClaudeSkillsForAwareness
      ? discoverProjectAgentsSkills(params.ctx.directory, sourceProvenance)
      : Promise.resolve([]),
    discoverOpencodeGlobalSkills(),
    discoverOpencodeProjectSkills(params.ctx.directory, sourceProvenance),
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
