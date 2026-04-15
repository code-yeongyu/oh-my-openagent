/// <reference types="bun-types" />

import type { AgentConfig } from "@opencode-ai/sdk"
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import * as agents from "../agents"
import * as shared from "../shared"
import * as sisyphusJunior from "../agents/sisyphus-junior"
import type { OhMyOpenCodeConfig } from "../config"
import * as agentLoader from "../features/claude-code-agent-loader"
import * as skillLoader from "../features/opencode-skill-loader"
import type { LoadedSkill } from "../features/opencode-skill-loader"
import { getAgentListDisplayName, getAgentRuntimeName } from "../shared/agent-display-names"
import { applyAgentConfig } from "./agent-config-handler"
import type { PluginComponents } from "./plugin-components-loader"

const BUILTIN_SISYPHUS_DISPLAY_NAME = getAgentListDisplayName("sisyphus")
const BUILTIN_SISYPHUS_JUNIOR_DISPLAY_NAME = getAgentListDisplayName("sisyphus-junior")
const BUILTIN_MULTIMODAL_LOOKER_DISPLAY_NAME = getAgentListDisplayName("multimodal-looker")

function createPluginComponents(): PluginComponents {
  return {
    commands: {},
    skills: {},
    agents: {},
    mcpServers: {},
    hooksConfigs: [],
    plugins: [],
    errors: [],
  }
}

function createBaseConfig(): Record<string, unknown> {
  return {
    model: "anthropic/claude-opus-4-6",
    agent: {},
  }
}

function createPluginConfig(): OhMyOpenCodeConfig {
  return {
    git_master: {
      commit_footer: true,
      include_co_authored_by: true,
      git_env_prefix: "GIT_MASTER=1",
    },
    sisyphus_agent: {
      planner_enabled: false,
    },
  }
}

describe("applyAgentConfig builtin override protection", () => {
  let createBuiltinAgentsSpy: ReturnType<typeof spyOn>
  let createSisyphusJuniorAgentSpy: ReturnType<typeof spyOn>
  let discoverConfigSourceSkillsSpy: ReturnType<typeof spyOn>
  let discoverUserClaudeSkillsSpy: ReturnType<typeof spyOn>
  let discoverProjectClaudeSkillsSpy: ReturnType<typeof spyOn>
  let discoverOpencodeGlobalSkillsSpy: ReturnType<typeof spyOn>
  let discoverOpencodeProjectSkillsSpy: ReturnType<typeof spyOn>
  let discoverProjectAgentsSkillsSpy: ReturnType<typeof spyOn>
  let discoverGlobalAgentsSkillsSpy: ReturnType<typeof spyOn>
  let loadUserAgentsSpy: ReturnType<typeof spyOn>
  let loadProjectAgentsSpy: ReturnType<typeof spyOn>
  let loadAgentDefinitionsSpy: ReturnType<typeof spyOn>
  let readOpencodeConfigAgentsSpy: ReturnType<typeof spyOn>
  let migrateAgentConfigSpy: ReturnType<typeof spyOn>
  let logSpy: ReturnType<typeof spyOn>

  const builtinSisyphusConfig: AgentConfig = {
    name: "Builtin Sisyphus",
    prompt: "builtin prompt",
    mode: "primary",
    order: 1,
  }

  const builtinOracleConfig: AgentConfig = {
    name: "oracle",
    prompt: "oracle prompt",
    mode: "subagent",
  }

  const builtinMultimodalLookerConfig: AgentConfig = {
    name: "multimodal-looker",
    prompt: "multimodal prompt",
    mode: "subagent",
  }

  const builtinAtlasConfig: AgentConfig = {
    name: "atlas",
    prompt: "atlas prompt",
    mode: "all",
    model: "openai/gpt-5.4",
  }

  const sisyphusJuniorConfig: AgentConfig = {
    name: "Sisyphus-Junior",
    prompt: "junior prompt",
    mode: "all",
  }

  beforeEach(() => {
    createBuiltinAgentsSpy = spyOn(agents, "createBuiltinAgents").mockResolvedValue({
      sisyphus: builtinSisyphusConfig,
      oracle: builtinOracleConfig,
      "multimodal-looker": builtinMultimodalLookerConfig,
      atlas: builtinAtlasConfig,
    })

    createSisyphusJuniorAgentSpy = spyOn(
      sisyphusJunior,
      "createSisyphusJuniorAgentWithOverrides",
    ).mockReturnValue(sisyphusJuniorConfig)

    discoverConfigSourceSkillsSpy = spyOn(
      skillLoader,
      "discoverConfigSourceSkills",
    ).mockResolvedValue([])
    discoverUserClaudeSkillsSpy = spyOn(
      skillLoader,
      "discoverUserClaudeSkills",
    ).mockResolvedValue([])
    discoverProjectClaudeSkillsSpy = spyOn(
      skillLoader,
      "discoverProjectClaudeSkills",
    ).mockResolvedValue([])
    discoverOpencodeGlobalSkillsSpy = spyOn(
      skillLoader,
      "discoverOpencodeGlobalSkills",
    ).mockResolvedValue([])
    discoverOpencodeProjectSkillsSpy = spyOn(
      skillLoader,
      "discoverOpencodeProjectSkills",
    ).mockResolvedValue([])
    discoverProjectAgentsSkillsSpy = spyOn(
      skillLoader,
      "discoverProjectAgentsSkills",
    ).mockResolvedValue([])
    discoverGlobalAgentsSkillsSpy = spyOn(
      skillLoader,
      "discoverGlobalAgentsSkills",
    ).mockResolvedValue([])

    loadUserAgentsSpy = spyOn(agentLoader, "loadUserAgents").mockReturnValue({})
    loadProjectAgentsSpy = spyOn(agentLoader, "loadProjectAgents").mockReturnValue({})
    loadAgentDefinitionsSpy = spyOn(agentLoader, "loadAgentDefinitions").mockReturnValue({})
    readOpencodeConfigAgentsSpy = spyOn(
      agentLoader,
      "readOpencodeConfigAgents",
    ).mockReturnValue({})

    migrateAgentConfigSpy = spyOn(shared, "migrateAgentConfig").mockImplementation(
      (config: Record<string, unknown>) => config,
    )
    logSpy = spyOn(shared, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    createBuiltinAgentsSpy.mockRestore()
    createSisyphusJuniorAgentSpy.mockRestore()
    discoverConfigSourceSkillsSpy.mockRestore()
    discoverUserClaudeSkillsSpy.mockRestore()
    discoverProjectClaudeSkillsSpy.mockRestore()
    discoverOpencodeGlobalSkillsSpy.mockRestore()
    discoverOpencodeProjectSkillsSpy.mockRestore()
    discoverProjectAgentsSkillsSpy.mockRestore()
    discoverGlobalAgentsSkillsSpy.mockRestore()
    loadUserAgentsSpy.mockRestore()
    loadProjectAgentsSpy.mockRestore()
    loadAgentDefinitionsSpy.mockRestore()
    readOpencodeConfigAgentsSpy.mockRestore()
    migrateAgentConfigSpy.mockRestore()
    logSpy.mockRestore()
  })

  test("registered agent keys are HTTP-header-safe (no parentheses) for UI selector compatibility", async () => {
    // given builtin agents are registered via applyAgentConfig

    // when applyAgentConfig runs
    const result = await applyAgentConfig({
      config: createBaseConfig(),
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    })

    // then every registered agent key must be HTTP-header-safe (no parentheses)
    // Parentheses in agent names cause HTTP header validation errors in
    // x-opencode-agent-name and prevent the agents from showing in the OpenCode UI.
    for (const key of Object.keys(result)) {
      expect(key).not.toMatch(/[()]/)
    }
  })

  test("filters user agents whose key matches the builtin display-name alias", async () => {
    // given
    loadUserAgentsSpy.mockReturnValue({
      [BUILTIN_SISYPHUS_DISPLAY_NAME]: {
        name: BUILTIN_SISYPHUS_DISPLAY_NAME,
        prompt: "user alias prompt",
        mode: "subagent",
      },
    })

    // when
    const result = await applyAgentConfig({
      config: createBaseConfig(),
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    })

    // then
    expect(result[BUILTIN_SISYPHUS_DISPLAY_NAME]).toEqual({
      ...builtinSisyphusConfig,
      name: getAgentRuntimeName("sisyphus"),
    })
  })

  test("filters user agents whose key differs from a builtin key only by case", async () => {
    // given
    loadUserAgentsSpy.mockReturnValue({
      SiSyPhUs: {
        name: "SiSyPhUs",
        prompt: "mixed-case prompt",
        mode: "subagent",
      },
    })

    // when
    const result = await applyAgentConfig({
      config: createBaseConfig(),
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    })

    // then
    expect(result[BUILTIN_SISYPHUS_DISPLAY_NAME]).toEqual({
      ...builtinSisyphusConfig,
      name: getAgentRuntimeName("sisyphus"),
    })
    expect(result.SiSyPhUs).toBeUndefined()
  })

  test("filters plugin agents whose key matches the builtin display-name alias", async () => {
    // given
    const pluginComponents = createPluginComponents()
    pluginComponents.agents = {
      [BUILTIN_SISYPHUS_DISPLAY_NAME]: {
        name: BUILTIN_SISYPHUS_DISPLAY_NAME,
        prompt: "plugin alias prompt",
        mode: "subagent",
      },
    }

    // when
    const result = await applyAgentConfig({
      config: createBaseConfig(),
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents,
    })

    // then
    expect(result[BUILTIN_SISYPHUS_DISPLAY_NAME]).toEqual({
      ...builtinSisyphusConfig,
      name: getAgentRuntimeName("sisyphus"),
    })
  })

  describe("#given protected builtin agents use hyphenated names", () => {
    describe("#when a user agent uses the underscored multimodal looker alias", () => {
      test("filters the override", async () => {
        // given
        loadUserAgentsSpy.mockReturnValue({
          multimodal_looker: {
            name: "multimodal_looker",
            prompt: "user multimodal alias prompt",
            mode: "subagent",
          },
        })

        // when
        const result = await applyAgentConfig({
          config: createBaseConfig(),
          pluginConfig: createPluginConfig(),
          ctx: { directory: "/tmp" },
          pluginComponents: createPluginComponents(),
        })

        // then
        expect(result[BUILTIN_MULTIMODAL_LOOKER_DISPLAY_NAME]).toEqual(builtinMultimodalLookerConfig)
        expect(result.multimodal_looker).toBeUndefined()
      })
    })

    describe("#when a user agent uses the underscored sisyphus junior alias", () => {
      test("filters the override", async () => {
        // given
        loadUserAgentsSpy.mockReturnValue({
          sisyphus_junior: {
            name: "sisyphus_junior",
            prompt: "user junior alias prompt",
            mode: "subagent",
          },
        })

        // when
        const result = await applyAgentConfig({
          config: createBaseConfig(),
          pluginConfig: createPluginConfig(),
          ctx: { directory: "/tmp" },
          pluginComponents: createPluginComponents(),
        })

        // then
        expect(result[BUILTIN_SISYPHUS_JUNIOR_DISPLAY_NAME]).toEqual(sisyphusJuniorConfig)
        expect(result.sisyphus_junior).toBeUndefined()
      })
    })
  })

  test("passes the resolved Atlas model to Sisyphus-Junior as its fallback default", async () => {
    // given

    // when
    await applyAgentConfig({
      config: createBaseConfig(),
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    })

    // then
    expect(createSisyphusJuniorAgentSpy).toHaveBeenCalledWith(undefined, "openai/gpt-5.4", false)
  })

  test("defaults mode to subagent for configAgent entries missing mode", async () => {
    // given
    const config = createBaseConfig()
    ;(config as Record<string, unknown>).agent = {
      "custom-reviewer": {
        name: "custom-reviewer",
        prompt: "Review code for security issues",
        description: "Custom code reviewer",
      },
    }

    // when
    const result = await applyAgentConfig({
      config,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    })

    // then
    const customAgent = result["custom-reviewer"] as Record<string, unknown>
    expect(customAgent).toBeDefined()
    expect(customAgent.mode).toBe("subagent")
  })

  test("preserves explicit mode on configAgent entries", async () => {
    // given
    const config = createBaseConfig()
    ;(config as Record<string, unknown>).agent = {
      "custom-primary": {
        name: "custom-primary",
        prompt: "Primary agent",
        mode: "primary",
      },
    }

    // when
    const result = await applyAgentConfig({
      config,
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    })

    // then
    const customAgent = result["custom-primary"] as Record<string, unknown>
    expect(customAgent).toBeDefined()
    expect(customAgent.mode).toBe("primary")
  })

  test("defaults mode to subagent for plugin agents missing mode", async () => {
    // given
    const pluginComponents = createPluginComponents()
    pluginComponents.agents = {
      "plugin-worker": {
        name: "plugin-worker",
        prompt: "Do work",
        description: "Plugin worker agent",
      } as Record<string, unknown>,
    }

    // when
    const result = await applyAgentConfig({
      config: createBaseConfig(),
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents,
    })

    // then
    const pluginAgent = result["plugin-worker"] as Record<string, unknown>
    expect(pluginAgent).toBeDefined()
    expect(pluginAgent.mode).toBe("subagent")
  })

  test("includes project and global .agents skills in builtin agent awareness", async () => {
    // given
    const projectAgentsSkill = {
      name: "project-agent-skill",
      definition: {
        name: "project-agent-skill",
        description: "Project agent skill",
        template: "template",
      },
      scope: "project",
    } satisfies LoadedSkill
    const globalAgentsSkill = {
      name: "global-agent-skill",
      definition: {
        name: "global-agent-skill",
        description: "Global agent skill",
        template: "template",
      },
      scope: "user",
    } satisfies LoadedSkill
    discoverProjectAgentsSkillsSpy.mockResolvedValue([projectAgentsSkill])
    discoverGlobalAgentsSkillsSpy.mockResolvedValue([globalAgentsSkill])

    // when
    await applyAgentConfig({
      config: createBaseConfig(),
      pluginConfig: createPluginConfig(),
      ctx: { directory: "/tmp" },
      pluginComponents: createPluginComponents(),
    })

    // then
    const discoveredSkills = createBuiltinAgentsSpy.mock.calls[0]?.[6]
    expect(discoveredSkills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "project-agent-skill" }),
        expect.objectContaining({ name: "global-agent-skill" }),
      ]),
    )
  })

  describe("agent_definitions and opencode.json integration", () => {
    test("agent_definitions agents appear in output", async () => {
      // given
      loadAgentDefinitionsSpy.mockReturnValue({
        "my-custom-agent": {
          name: "my-custom-agent",
          prompt: "test custom agent from agent_definitions",
          mode: "subagent",
        },
      })
      const pluginConfig = createPluginConfig()
      pluginConfig.agent_definitions = ["/fake/path/agent.md"]

      // when
      const result = await applyAgentConfig({
        config: createBaseConfig(),
        pluginConfig,
        ctx: { directory: "/tmp" },
        pluginComponents: createPluginComponents(),
      })

      // then
      expect(result["my-custom-agent"]).toBeDefined()
      expect(result["my-custom-agent"]?.prompt).toBe("test custom agent from agent_definitions")
    })

    test("opencode.json agents appear in output", async () => {
      // given
      readOpencodeConfigAgentsSpy.mockReturnValue({
        "opencode-agent": {
          name: "opencode-agent",
          prompt: "test opencode config agent",
          mode: "subagent",
          description: "(opencode-config) OC",
        },
      })

      // when
      const result = await applyAgentConfig({
        config: createBaseConfig(),
        pluginConfig: createPluginConfig(),
        ctx: { directory: "/tmp" },
        pluginComponents: createPluginComponents(),
      })

      // then
      expect(result["opencode-agent"]).toBeDefined()
      expect(result["opencode-agent"]?.prompt).toBe("test opencode config agent")
      expect(result["opencode-agent"]?.description).toBe("(opencode-config) OC")
    })

    test("agent_definitions agents subject to disabled_agents filtering", async () => {
      // given
      loadAgentDefinitionsSpy.mockReturnValue({
        "disabled-custom-agent": {
          name: "disabled-custom-agent",
          prompt: "this should be filtered",
          mode: "subagent",
        },
      })
      const pluginConfig = createPluginConfig()
      pluginConfig.agent_definitions = ["/fake/path/agent.md"]
      pluginConfig.disabled_agents = ["disabled-custom-agent"]

      // when
      const result = await applyAgentConfig({
        config: createBaseConfig(),
        pluginConfig,
        ctx: { directory: "/tmp" },
        pluginComponents: createPluginComponents(),
      })

      // then
      expect(result["disabled-custom-agent"]).toBeUndefined()
    })

    test("agent_definitions cannot override builtin agents", async () => {
      // given
      loadAgentDefinitionsSpy.mockReturnValue({
        oracle: {
          name: "oracle",
          prompt: "evil override prompt",
          mode: "subagent",
        },
      })
      const pluginConfig = createPluginConfig()
      pluginConfig.agent_definitions = ["/fake/path/agent.md"]

      // when
      const result = await applyAgentConfig({
        config: createBaseConfig(),
        pluginConfig,
        ctx: { directory: "/tmp" },
        pluginComponents: createPluginComponents(),
      })

      // then
      expect(result.oracle).toBeDefined()
      expect(result.oracle?.prompt).not.toBe("evil override prompt")
    })

    test("precedence: configAgents override agent_definitions", async () => {
      // given
      loadAgentDefinitionsSpy.mockReturnValue({
        "shared-name": {
          name: "shared-name",
          prompt: "from-definitions",
          mode: "subagent",
        },
      })
      const config = createBaseConfig()
      ;(config as Record<string, unknown>).agent = {
        "shared-name": {
          name: "shared-name",
          prompt: "from-config",
          mode: "subagent",
        },
      }
      const pluginConfig = createPluginConfig()
      pluginConfig.agent_definitions = ["/fake/path/agent.md"]

      // when
      const result = await applyAgentConfig({
        config,
        pluginConfig,
        ctx: { directory: "/tmp" },
        pluginComponents: createPluginComponents(),
      })

      // then
      expect(result["shared-name"]).toBeDefined()
      expect(result["shared-name"]?.prompt).toBe("from-config")
    })

    test("precedence: agent_definitions overrides project agents", async () => {
      // given
      loadProjectAgentsSpy.mockReturnValue({
        "shared-name": {
          name: "shared-name",
          prompt: "from-project",
          mode: "subagent",
        },
      })
      loadAgentDefinitionsSpy.mockReturnValue({
        "shared-name": {
          name: "shared-name",
          prompt: "from-definitions",
          mode: "subagent",
        },
      })
      const pluginConfig = createPluginConfig()
      pluginConfig.agent_definitions = ["/fake/path/agent.md"]

      // when
      const result = await applyAgentConfig({
        config: createBaseConfig(),
        pluginConfig,
        ctx: { directory: "/tmp" },
        pluginComponents: createPluginComponents(),
      })

      // then
      expect(result["shared-name"]).toBeDefined()
      expect(result["shared-name"]?.prompt).toBe("from-definitions")
    })

    test("both Sisyphus-enabled and disabled paths include new sources", async () => {
      // given
      loadAgentDefinitionsSpy.mockReturnValue({
        "definitions-agent": {
          name: "definitions-agent",
          prompt: "from agent_definitions",
          mode: "subagent",
        },
      })
      readOpencodeConfigAgentsSpy.mockReturnValue({
        "opencode-agent": {
          name: "opencode-agent",
          prompt: "from opencode.json",
          mode: "subagent",
        },
      })
      const pluginConfig = createPluginConfig()
      pluginConfig.agent_definitions = ["/fake/path/agent.md"]
      if (pluginConfig.sisyphus_agent) {
        pluginConfig.sisyphus_agent.planner_enabled = false
      }

      // when
      const result = await applyAgentConfig({
        config: createBaseConfig(),
        pluginConfig,
        ctx: { directory: "/tmp" },
        pluginComponents: createPluginComponents(),
      })

      // then
      expect(result["definitions-agent"]).toBeDefined()
      expect(result["definitions-agent"]?.prompt).toBe("from agent_definitions")
      expect(result["opencode-agent"]).toBeDefined()
      expect(result["opencode-agent"]?.prompt).toBe("from opencode.json")
    })
  })
})
