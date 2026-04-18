import { describe, expect, test } from "bun:test";
import { maybeCreateSisyphusConfig } from "./sisyphus-agent";
import type { AgentOverrides } from "../types";
import type { CategoryConfig } from "../../config/schema";

describe("maybeCreateSisyphusConfig", () => {
  describe("#given GPT model with user override allowing apply_patch", () => {
    test("#when config is created #then apply_patch is still denied", () => {
      // given
      const agentOverrides: AgentOverrides = {
        sisyphus: {
          model: "openai/gpt-5.4",
          permission: {
            apply_patch: "allow",
          },
        },
      };
      const mergedCategories: Record<string, CategoryConfig> = {};

      // when
      const config = maybeCreateSisyphusConfig({
        disabledAgents: [],
        agentOverrides,
        availableModels: new Set(["openai/gpt-5.4"]),
        systemDefaultModel: "openai/gpt-5.4",
        isFirstRunNoCache: false,
        availableAgents: [],
        availableSkills: [],
        availableCategories: [],
        mergedCategories,
        useTaskSystem: false,
      });

      // then
      expect(config).toBeDefined();
      expect(config?.model).toBe("openai/gpt-5.4");
      expect(config?.permission).toHaveProperty("apply_patch", "deny");
    });
  });

  describe("#given non-GPT model with user override", () => {
    test("#when config is created #then apply_patch is not forced to deny", () => {
      // given
      const agentOverrides: AgentOverrides = {
        sisyphus: {
          model: "anthropic/claude-opus-4-7",
          permission: {
            apply_patch: "allow",
          },
        },
      };
      const mergedCategories: Record<string, CategoryConfig> = {};

      // when
      const config = maybeCreateSisyphusConfig({
        disabledAgents: [],
        agentOverrides,
        availableModels: new Set(["anthropic/claude-opus-4-7"]),
        systemDefaultModel: "anthropic/claude-opus-4-7",
        isFirstRunNoCache: false,
        availableAgents: [],
        availableSkills: [],
        availableCategories: [],
        mergedCategories,
        useTaskSystem: false,
      });

      // then
      expect(config).toBeDefined();
      expect(config?.model).toBe("anthropic/claude-opus-4-7");
      // Claude models should allow the user override
      expect(config?.permission).toHaveProperty("apply_patch", "allow");
    });
  });

  describe("#given generic GPT model with user override allowing apply_patch", () => {
    test("#when config is created #then apply_patch is still denied", () => {
      // given
      const agentOverrides: AgentOverrides = {
        sisyphus: {
          model: "openai/gpt-4o",
          permission: {
            apply_patch: "allow",
          },
        },
      };
      const mergedCategories: Record<string, CategoryConfig> = {};

      // when
      const config = maybeCreateSisyphusConfig({
        disabledAgents: [],
        agentOverrides,
        availableModels: new Set(["openai/gpt-4o"]),
        systemDefaultModel: "openai/gpt-4o",
        isFirstRunNoCache: false,
        availableAgents: [],
        availableSkills: [],
        availableCategories: [],
        mergedCategories,
        useTaskSystem: false,
      });

      // then
      expect(config).toBeDefined();
      expect(config?.model).toBe("openai/gpt-4o");
      expect(config?.permission).toHaveProperty("apply_patch", "deny");
    });
  });
});
