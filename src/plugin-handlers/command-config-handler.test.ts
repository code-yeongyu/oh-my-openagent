/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as builtinCommands from "../features/builtin-commands";
import * as commandLoader from "../features/claude-code-command-loader";
import * as skillLoader from "../features/opencode-skill-loader";
import type { OhMyOpenCodeConfig } from "../config";
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

  test("pushes host config skills into mergedSkillsRef so the runtime skill tool can load them (#4302, #4250)", async () => {
    // given - second call to discoverConfigSourceSkills returns superpowers-style host skills
    discoverConfigSourceSkillsSpy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          name: "brainstorming",
          definition: {
            name: "brainstorming",
            description: "Superpowers brainstorming skill",
            template: "...",
          },
          scope: "config",
        },
        {
          name: "writing-skills",
          definition: {
            name: "writing-skills",
            description: "Superpowers writing-skills skill",
            template: "...",
          },
          scope: "config",
        },
      ]);

    // The ref starts with whatever createSkillContext produced at plugin init —
    // simulate one pre-existing builtin to prove we are *adding*, not replacing.
    const mergedSkillsRef: Parameters<typeof applyCommandConfig>[0]["mergedSkillsRef"] = [
      {
        name: "git-master",
        definition: { name: "git-master", description: "builtin", template: "" },
        scope: "plugin",
      },
    ];

    const config: Record<string, unknown> = {
      command: {},
      skills: { paths: ["/host/superpowers/skills"] },
    };

    // when
    await applyCommandConfig({
      config,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
      mergedSkillsRef,
    });

    // then - the host skills landed in the live mergedSkills array. The
    // runtime skill tool reads this same ref via skillContext.mergedSkills,
    // so a subsequent `skill name=brainstorming` call resolves instead of
    // throwing "Skill or command \"brainstorming\" not found" (#4302/#4250).
    const names = mergedSkillsRef!.map((skill) => skill.name);
    expect(names).toContain("git-master");
    expect(names).toContain("brainstorming");
    expect(names).toContain("writing-skills");
  });

  test("does not duplicate entries when a host skill name already exists in mergedSkillsRef", async () => {
    // given - discoverConfigSourceSkills hands back a skill whose name already
    //         lives in the ref (a host plugin shipping a skill named like one
    //         of our builtins). The pre-existing entry must win and no
    //         duplicate must be added — the runtime skill resolver is
    //         deterministic per name.
    discoverConfigSourceSkillsSpy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          name: "brainstorming",
          definition: {
            name: "brainstorming",
            description: "Host duplicate",
            template: "...",
          },
          scope: "config",
        },
      ]);
    const mergedSkillsRef: Parameters<typeof applyCommandConfig>[0]["mergedSkillsRef"] = [
      {
        name: "brainstorming",
        definition: { name: "brainstorming", description: "builtin", template: "" },
        scope: "plugin",
      },
    ];
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
      mergedSkillsRef,
    });

    // then
    expect(mergedSkillsRef!).toHaveLength(1);
    expect(mergedSkillsRef![0]?.definition.description).toBe("builtin");
  });

  test("is a no-op on mergedSkillsRef when it is undefined (preserves legacy callers)", async () => {
    // given - host config skills are discovered but no ref is supplied
    discoverConfigSourceSkillsSpy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          name: "brainstorming",
          definition: {
            name: "brainstorming",
            description: "Superpowers brainstorming skill",
            template: "...",
          },
          scope: "config",
        },
      ]);
    const config: Record<string, unknown> = {
      command: {},
      skills: { paths: ["/host/skills"] },
    };

    // when / then - omitting mergedSkillsRef must not throw and must still
    // register host skills as commands (the pre-#4302 behaviour).
    await expect(
      applyCommandConfig({
        config,
        pluginConfig: createPluginConfig(),
        ctx: { directory: "/tmp" },
        pluginComponents: createPluginComponents(),
      }),
    ).resolves.toBeUndefined();

    const commandConfig = config.command as Record<string, { description?: string }>;
    expect(commandConfig["brainstorming"]?.description).toContain("Superpowers brainstorming");
  });
});
