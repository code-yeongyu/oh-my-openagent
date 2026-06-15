/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as builtinCommands from "../features/builtin-commands";
import * as commandLoader from "../features/claude-code-command-loader";
import * as mcpLoader from "../features/claude-code-mcp-loader";
import * as skillLoader from "../features/opencode-skill-loader";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "../config";
import type { LoadedSkill } from "../features/opencode-skill-loader/types";
import type { PluginComponents } from "./plugin-components-loader";
import { applyCommandConfig } from "./command-config-handler";
import {
  getAgentDisplayName,
  getAgentListDisplayName,
} from "../shared/agent-display-names";

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
  return {
    git_master: {
      commit_footer: true,
      include_co_authored_by: true,
      git_env_prefix: "GIT_MASTER=1",
    },
  };
}

function createParsedPluginConfig(overrides: Record<string, unknown>): OhMyOpenCodeConfig {
  return OhMyOpenCodeConfigSchema.parse({
    ...createPluginConfig(),
    ...overrides,
  });
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
  let getSystemMcpServerNamesSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getSystemMcpServerNamesSpy = spyOn(mcpLoader, "getSystemMcpServerNames").mockReturnValue(new Set());
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
    getSystemMcpServerNamesSpy.mockRestore();
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

  test("registers builtin skills like init-deep and security-review as opencode commands", async () => {
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
    expect(commandConfig["init-deep"]?.description).toContain("Initialize hierarchical AGENTS.md");
    expect(commandConfig["init-deep"]?.template).toContain("<skill-instruction>");
    expect(commandConfig["init-deep"]?.template).toContain("$ARGUMENTS");
    expect(commandConfig["security-review"]?.template).toContain("<skill-instruction>");
    expect(commandConfig["team-mode"]).toBeUndefined();
  });

  test("keeps the builtin command definition when a builtin skill shares its name", async () => {
    // given
    loadBuiltinCommandsSpy.mockReturnValue({
      "remove-ai-slops": {
        name: "remove-ai-slops",
        description: "(builtin) Remove AI-generated code smells from branch changes and critically review the results",
        template: "builtin command template",
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
    const commandConfig = config.command as Record<string, { template?: string }>;
    expect(commandConfig["remove-ai-slops"]?.template).toBe("builtin command template");
  });

  test("excludes builtin skills disabled via disabled_skills from the command config", async () => {
    // given
    const pluginConfig: OhMyOpenCodeConfig = {
      ...createPluginConfig(),
      disabled_skills: ["init-deep"],
    };
    const config: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config,
      pluginConfig,
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const commandConfig = config.command as Record<string, { template?: string }>;
    expect(commandConfig["init-deep"]).toBeUndefined();
    expect(commandConfig["security-review"]?.template).toContain("<skill-instruction>");
  });

  test("excludes builtin skills whose MCP servers already exist in the system MCP config", async () => {
    // given
    getSystemMcpServerNamesSpy.mockReturnValue(new Set(["playwright"]));
    const config: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const commandConfig = config.command as Record<string, { template?: string }>;
    expect(commandConfig["playwright"]).toBeUndefined();
    expect(commandConfig["init-deep"]?.template).toContain("<skill-instruction>");
  });

  test("#given disabled_commands contains remove-ai-slops #when applying command config #then the skill-backed command does not resurrect", async () => {
    // given
    const pluginConfig: OhMyOpenCodeConfig = {
      ...createPluginConfig(),
      disabled_commands: ["remove-ai-slops"],
    };
    const config: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config,
      pluginConfig,
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const commandConfig = config.command as Record<string, unknown>;
    expect(commandConfig["remove-ai-slops"]).toBeUndefined();

    const controlConfig: Record<string, unknown> = { command: {} };
    await applyCommandConfig({
      config: controlConfig,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });
    const controlCommandConfig = controlConfig.command as Record<string, unknown>;
    expect(controlCommandConfig["remove-ai-slops"]).toBeDefined();
  });

  test("#given disabled_skills contains debugging #then no /debugging command registers", async () => {
    // given
    const pluginConfig = {
      ...createPluginConfig(),
      disabled_skills: ["debugging"],
    };
    const config: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config,
      pluginConfig,
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const commandConfig = config.command as Record<string, unknown>;
    expect(commandConfig["debugging"]).toBeUndefined();

    const controlConfig: Record<string, unknown> = { command: {} };
    await applyCommandConfig({
      config: controlConfig,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    });
    const controlCommandConfig = controlConfig.command as Record<string, unknown>;
    expect(controlCommandConfig["debugging"]).toBeDefined();
  });

  for (const [label, skills] of [
    ["skills.disable", { disable: ["debugging"] }],
    ["skills.<name>: false", { debugging: false }],
    ["skills.<name>.disable: true", { debugging: { disable: true } }],
  ] as const) {
    test(`#given ${label} disables debugging #then no /debugging command registers`, async () => {
      // given
      const pluginConfig = createParsedPluginConfig({
        skills,
      });
      const config: Record<string, unknown> = { command: {} };

      // when
      await applyCommandConfig({
        config,
        pluginConfig,
        ctx: { directory: "/tmp" },
        pluginComponents: createPluginComponents(),
      });

      // then
      const commandConfig = config.command as Record<string, unknown>;
      expect(commandConfig["debugging"]).toBeUndefined();
    });
  }

  test("#given mixed-case config-source skill disabled by skills.disable #then no hostile slash command registers", async () => {
    // given
    const poisonedSkill: LoadedSkill = {
      name: "Project-Poison",
      definition: {
        name: "Project-Poison",
        description: "HOSTILE DESCRIPTION TEXT should never reach command config",
        template: "poisoned template",
      },
      scope: "config",
    };
    discoverConfigSourceSkillsSpy.mockResolvedValueOnce([poisonedSkill]).mockResolvedValueOnce([]);
    const pluginConfig = createParsedPluginConfig({
      skills: { disable: ["project-poison"] },
    });
    const config: Record<string, unknown> = { command: {} };

    // when
    await applyCommandConfig({
      config,
      pluginConfig,
      ctx: { directory: "/tmp/project" },
      pluginComponents: createPluginComponents(),
    });

    // then
    const commandConfig = config.command as Record<string, unknown>;
    expect(commandConfig["Project-Poison"]).toBeUndefined();
    expect(JSON.stringify(commandConfig)).not.toContain("HOSTILE DESCRIPTION TEXT");
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
