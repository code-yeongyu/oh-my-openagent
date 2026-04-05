import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as builtinCommands from "../features/builtin-commands";
import * as commandLoader from "../features/claude-code-command-loader";
import * as skillLoader from "../features/opencode-skill-loader";
import type { OhMyOpenCodeConfig } from "../config";
import type { PluginComponents } from "./plugin-components-loader";
import { applyCommandConfig } from "./command-config-handler";
import { getAgentListDisplayName } from "../shared/agent-display-names";

function createPluginComponents(): PluginComponents {
  return {
    commands: {},
    skills: {},
    agents: {},
    mcpServers: {},
    hooksConfigs: [],
    plugins: [],
    errors: [],
  };
}

function createPluginConfig(): OhMyOpenCodeConfig {
  return {};
}

describe("applyCommandConfig", () => {
  let loadBuiltinCommandsSpy: ReturnType<typeof spyOn>;
  let loadUserCommandsSpy: ReturnType<typeof spyOn>;
  let loadProjectCommandsSpy: ReturnType<typeof spyOn>;
  let loadOpencodeGlobalCommandsSpy: ReturnType<typeof spyOn>;
  let loadOpencodeProjectCommandsSpy: ReturnType<typeof spyOn>;
  let discoverConfigSourceSkillsSpy: ReturnType<typeof spyOn>;
  let loadUserSkillsSpy: ReturnType<typeof spyOn>;
  let loadProjectSkillsSpy: ReturnType<typeof spyOn>;
  let loadOpencodeGlobalSkillsSpy: ReturnType<typeof spyOn>;
  let loadOpencodeProjectSkillsSpy: ReturnType<typeof spyOn>;
  let loadProjectAgentsSkillsSpy: ReturnType<typeof spyOn>;
  let loadGlobalAgentsSkillsSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    loadBuiltinCommandsSpy = spyOn(builtinCommands, "loadBuiltinCommands").mockReturnValue({});
    loadUserCommandsSpy = spyOn(commandLoader, "loadUserCommands").mockResolvedValue({});
    loadProjectCommandsSpy = spyOn(commandLoader, "loadProjectCommands").mockResolvedValue({});
    loadOpencodeGlobalCommandsSpy = spyOn(commandLoader, "loadOpencodeGlobalCommands").mockResolvedValue({});
    loadOpencodeProjectCommandsSpy = spyOn(commandLoader, "loadOpencodeProjectCommands").mockResolvedValue({});
    discoverConfigSourceSkillsSpy = spyOn(skillLoader, "discoverConfigSourceSkills").mockResolvedValue([]);
    loadUserSkillsSpy = spyOn(skillLoader, "loadUserSkills").mockResolvedValue({});
    loadProjectSkillsSpy = spyOn(skillLoader, "loadProjectSkills").mockResolvedValue({});
    loadOpencodeGlobalSkillsSpy = spyOn(skillLoader, "loadOpencodeGlobalSkills").mockResolvedValue({});
    loadOpencodeProjectSkillsSpy = spyOn(skillLoader, "loadOpencodeProjectSkills").mockResolvedValue({});
    loadProjectAgentsSkillsSpy = spyOn(skillLoader, "loadProjectAgentsSkills").mockResolvedValue({});
    loadGlobalAgentsSkillsSpy = spyOn(skillLoader, "loadGlobalAgentsSkills").mockResolvedValue({});
  });

  afterEach(() => {
    loadBuiltinCommandsSpy.mockRestore();
    loadUserCommandsSpy.mockRestore();
    loadProjectCommandsSpy.mockRestore();
    loadOpencodeGlobalCommandsSpy.mockRestore();
    loadOpencodeProjectCommandsSpy.mockRestore();
    discoverConfigSourceSkillsSpy.mockRestore();
    loadUserSkillsSpy.mockRestore();
    loadProjectSkillsSpy.mockRestore();
    loadOpencodeGlobalSkillsSpy.mockRestore();
    loadOpencodeProjectSkillsSpy.mockRestore();
    loadProjectAgentsSkillsSpy.mockRestore();
    loadGlobalAgentsSkillsSpy.mockRestore();
  });

  test("includes .agents skills in command config", async () => {
    // given
    loadProjectAgentsSkillsSpy.mockResolvedValue({
      "agents-project-skill": {
        description: "(project - Skill) Agents project skill",
        template: "template",
      },
    });
    loadGlobalAgentsSkillsSpy.mockResolvedValue({
      "agents-global-skill": {
        description: "(user - Skill) Agents global skill",
        template: "template",
      },
    });
    const config: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const commandConfig = config.command as Record<string, { description?: string }>;
    expect(commandConfig["agents-project-skill"]?.description).toContain("Agents project skill");
    expect(commandConfig["agents-global-skill"]?.description).toContain("Agents global skill");
  });

  test("remaps Atlas command agents to the list display name used by runtime agent lookup", async () => {
    // given
    loadBuiltinCommandsSpy.mockReturnValue({
      "start-work": {
        name: "start-work",
        description: "(builtin) Start work",
        template: "template",
        agent: "atlas",
      },
    });
    const config: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const commandConfig = config.command as Record<string, { agent?: string }>;
    expect(commandConfig["start-work"]?.agent).toBe(getAgentListDisplayName("atlas"));
  });
});
