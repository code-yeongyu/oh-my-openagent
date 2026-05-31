/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { OhMyOpenCodeConfig } from "../config";
import * as builtinCommands from "../features/builtin-commands";
import * as commandLoader from "../features/claude-code-command-loader";
import * as skillLoader from "../features/opencode-skill-loader";
import {
  getAgentDisplayName,
  getAgentListDisplayName,
} from "../shared/agent-display-names";
import { applyCommandConfig } from "./command-config-handler";
import type { PluginComponents } from "./plugin-components-loader";

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

function createPluginConfig(overrides: Partial<OhMyOpenCodeConfig> = {}): OhMyOpenCodeConfig {
  return {
    git_master: {
      commit_footer: true,
      include_co_authored_by: true,
      git_env_prefix: "GIT_MASTER=1",
    },
    ...overrides,
  };
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

  test("includes builtin skills in command config", async () => {
    // given
    const config: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const commandConfig = config.command as Record<string, { description?: string; template?: string }>;
    expect(commandConfig["init-deep"]?.description).toContain("hierarchical AGENTS.md");
    expect(commandConfig["init-deep"]?.template).toContain("Generate hierarchical AGENTS.md files");
  });

  test("excludes disabled builtin skills from command config", async () => {
    // given
    const config: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config,
      pluginConfig: createPluginConfig({ disabled_skills: ["init-deep"] }),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const commandConfig = config.command as Record<string, unknown>;
    expect(commandConfig["init-deep"]).toBeUndefined();
  });

  test("keeps builtin command precedence over same-name builtin skills", async () => {
    // given
    loadBuiltinCommandsSpy.mockReturnValue({
      "remove-ai-slops": {
        name: "remove-ai-slops",
        description: "Builtin command wins",
        template: "command template",
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
    const commandConfig = config.command as Record<string, { description?: string; template?: string }>;
    expect(commandConfig["remove-ai-slops"]?.description).toBe("Builtin command wins");
    expect(commandConfig["remove-ai-slops"]?.template).toBe("command template");
  });

  test("allows higher-precedence project skills to override builtin skill commands", async () => {
    // given
    loadProjectSkillsSpy.mockResolvedValue({
      "init-deep": {
        description: "Project init-deep skill",
        template: "project template",
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
    const commandConfig = config.command as Record<string, { description?: string; template?: string }>;
    expect(commandConfig["init-deep"]?.description).toBe("Project init-deep skill");
    expect(commandConfig["init-deep"]?.template).toBe("project template");
  });

  test("uses browser provider gating for builtin skill commands", async () => {
    // given
    const defaultConfig: Record<string, unknown> = { command: {} };
    const agentBrowserConfig: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config: defaultConfig,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });
    await applyCommandConfig({
      config: agentBrowserConfig,
      pluginConfig: createPluginConfig({ browser_automation_engine: { provider: "agent-browser" } }),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const defaultCommands = defaultConfig.command as Record<string, unknown>;
    const agentBrowserCommands = agentBrowserConfig.command as Record<string, unknown>;
    expect(defaultCommands.playwright).toBeDefined();
    expect(defaultCommands["agent-browser"]).toBeUndefined();
    expect(agentBrowserCommands["agent-browser"]).toBeDefined();
    expect(agentBrowserCommands.playwright).toBeUndefined();
  });

  test("uses team-mode gating for builtin skill commands", async () => {
    // given
    const defaultConfig: Record<string, unknown> = { command: {} };
    const teamModeConfig: Record<string, unknown> = { command: {} };
    const disabledTeamModeConfig: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config: defaultConfig,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });
    await applyCommandConfig({
      config: teamModeConfig,
      pluginConfig: createPluginConfig({ team_mode: { enabled: true } }),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });
    await applyCommandConfig({
      config: disabledTeamModeConfig,
      pluginConfig: createPluginConfig({
        disabled_skills: ["team-mode"],
        team_mode: { enabled: true },
      }),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const defaultCommands = defaultConfig.command as Record<string, unknown>;
    const teamModeCommands = teamModeConfig.command as Record<string, unknown>;
    const disabledTeamModeCommands = disabledTeamModeConfig.command as Record<string, unknown>;
    expect(defaultCommands["team-mode"]).toBeUndefined();
    expect(teamModeCommands["team-mode"]).toBeDefined();
    expect(disabledTeamModeCommands["team-mode"]).toBeUndefined();
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

  test("normalizes Atlas command agents to the runtime list name used by opencode command routing", async () => {
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

  test("normalizes legacy display-name command agents to the runtime list name", async () => {
    // given
    loadBuiltinCommandsSpy.mockReturnValue({
      "start-work": {
        name: "start-work",
        description: "(builtin) Start work",
        template: "template",
        agent: getAgentDisplayName("atlas"),
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

  test("includes host config skills declared in config.skills.paths by other plugins", async () => {
    // given - second call to discoverConfigSourceSkills returns host config skills
    discoverConfigSourceSkillsSpy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          name: "host-config-skill",
          definition: {
            name: "host-config-skill",
            description: "Host config skill",
            template: "template",
          },
          scope: "config",
        },
      ]);
    const config: Record<string, unknown> = {
      command: {},
      skills: { paths: ["/host/skills"] },
    };

    // when
    await applyCommandConfig({
      config,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const commandConfig = config.command as Record<string, { description?: string }>;
    expect(commandConfig["host-config-skill"]?.description).toContain("Host config skill");
  });
});
