import { afterEach, describe, expect, test } from "bun:test";
import {
  isAgentRegistered,
  registerAgentName,
  _resetForTesting as resetSessionStateForTesting,
} from "../features/claude-code-session-state";
import { _resetOverrideDisplayNamesForTesting, getAgentConfigKey } from "../shared/agent-display-names";
import type { OhMyOpenCodeConfig } from "../config";
import { finalizeAgentConfig } from "./agent-config-finalizer";

function createPluginConfig(): OhMyOpenCodeConfig {
  return {
    sisyphus_agent: {
      planner_enabled: false,
    },
  };
}

function createPluginConfigWithOverrides(): OhMyOpenCodeConfig {
  return {
    sisyphus_agent: {
      planner_enabled: false,
    },
    agents: {
      sisyphus: { displayName: "总指挥" },
      atlas: { displayName: "アトラス" },
    },
  };
}

describe("finalizeAgentConfig", () => {
  afterEach(() => {
    resetSessionStateForTesting();
    _resetOverrideDisplayNamesForTesting();
  });

  test("does not throw or keep stale registrations when config.agent is absent", () => {
    // given
    registerAgentName("stale-agent");

    // when
    const result = finalizeAgentConfig({
      config: {},
      pluginConfig: createPluginConfig(),
      configuredDefaultAgent: undefined,
    });

    // then
    expect(result).toEqual({});
    expect(isAgentRegistered("stale-agent")).toBe(false);
  });

  test("registers override display names so reverse lookups resolve after finalization", () => {
    // given plugin config with displayName overrides
    const config: Record<string, unknown> = {
      agent: {
        sisyphus: { name: "sisyphus" },
        atlas: { name: "atlas" },
      },
    };

    // when finalizeAgentConfig is called
    finalizeAgentConfig({
      config,
      pluginConfig: createPluginConfigWithOverrides(),
      configuredDefaultAgent: undefined,
    });

    // then reverse lookups resolve override display names to config keys
    expect(getAgentConfigKey("总指挥")).toBe("sisyphus");
    expect(getAgentConfigKey("アトラス")).toBe("atlas");
  });

  test("reverse lookups do NOT resolve override names before finalizeAgentConfig is called", () => {
    // given no finalization has happened (override registry is empty)
    // (afterEach from previous test already cleared)

    // when getAgentConfigKey called with a custom name that hasn't been registered
    // then returns lowercased unknown (not a config key)
    expect(getAgentConfigKey("总指挥")).toBe("总指挥");
  });

  test("normalizes legacy agent keys in overrides when finalizing config", () => {
    // given plugin config with a legacy agent override key
    const pluginConfig = createPluginConfig();
    pluginConfig.agents = {
      omo: { displayName: "总指挥" },
    } as unknown as OhMyOpenCodeConfig["agents"];

    const config: Record<string, unknown> = {
      agent: {
        sisyphus: { name: "sisyphus" },
      },
    };

    // when finalizeAgentConfig runs
    finalizeAgentConfig({
      config,
      pluginConfig,
      configuredDefaultAgent: undefined,
    });

    // then getAgentConfigKey resolves "总指挥" back to canonical "sisyphus"
    expect(getAgentConfigKey("总指挥")).toBe("sisyphus");
  });
});
