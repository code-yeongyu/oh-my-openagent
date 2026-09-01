import { afterEach, describe, expect, test } from "bun:test";
import {
  isAgentRegistered,
  registerAgentName,
  _resetForTesting as resetSessionStateForTesting,
} from "../features/claude-code-session-state";
import type { OhMyOpenCodeConfig } from "../config";
import { finalizeAgentConfig } from "./agent-config-finalizer";

function createPluginConfig(): OhMyOpenCodeConfig {
  return {
    sisyphus_agent: {
      planner_enabled: false,
    },
  };
}

describe("finalizeAgentConfig", () => {
  afterEach(() => {
    resetSessionStateForTesting();
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
});
