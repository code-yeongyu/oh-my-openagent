/// <reference types="bun-types" />

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
          } as Record<string, "allow">,
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
          } as Record<string, "allow">,
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

  describe("#given Opus 4.7 model with user override allowing grep and glob", () => {
    test("#when config is created #then grep and glob are still denied", () => {
      // given
      const agentOverrides: AgentOverrides = {
        sisyphus: {
          model: "anthropic/claude-opus-4-7",
          permission: {
            grep: "allow",
            glob: "allow",
          } as Record<string, "allow">,
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
      expect(config?.permission).toHaveProperty("grep", "deny");
      expect(config?.permission).toHaveProperty("glob", "deny");
    });
  });

  describe("#given dotted Opus 4.7 model with user override allowing grep and glob", () => {
    test("#when config is created #then grep and glob are still denied", () => {
      // given
      const agentOverrides: AgentOverrides = {
        sisyphus: {
          model: "anthropic/claude-opus-4.7",
          permission: {
            grep: "allow",
            glob: "allow",
          } as Record<string, "allow">,
        },
      };
      const mergedCategories: Record<string, CategoryConfig> = {};

      // when
      const config = maybeCreateSisyphusConfig({
        disabledAgents: [],
        agentOverrides,
        availableModels: new Set(["anthropic/claude-opus-4.7"]),
        systemDefaultModel: "anthropic/claude-opus-4.7",
        isFirstRunNoCache: false,
        availableAgents: [],
        availableSkills: [],
        availableCategories: [],
        mergedCategories,
        useTaskSystem: false,
      });

      // then
      expect(config?.permission).toHaveProperty("grep", "deny");
      expect(config?.permission).toHaveProperty("glob", "deny");
    });
  });

  describe("#given GPT 5.5 model with user override allowing grep and glob", () => {
    test("#when config is created #then grep and glob are still denied", () => {
      // given
      const agentOverrides: AgentOverrides = {
        sisyphus: {
          model: "openai/gpt-5.5",
          permission: {
            grep: "allow",
            glob: "allow",
          } as Record<string, "allow">,
        },
      };
      const mergedCategories: Record<string, CategoryConfig> = {};

      // when
      const config = maybeCreateSisyphusConfig({
        disabledAgents: [],
        agentOverrides,
        availableModels: new Set(["openai/gpt-5.5"]),
        systemDefaultModel: "openai/gpt-5.5",
        isFirstRunNoCache: false,
        availableAgents: [],
        availableSkills: [],
        availableCategories: [],
        mergedCategories,
        useTaskSystem: false,
      });

      // then
      expect(config?.permission).toHaveProperty("grep", "deny");
      expect(config?.permission).toHaveProperty("glob", "deny");
    });
  });

  describe("#given frontier default model with category override to non-frontier model", () => {
    test("#when config is created #then stale grep and glob denies are cleared", () => {
      // given
      const agentOverrides: AgentOverrides = {
        sisyphus: {
          category: "non-frontier",
        },
      };
      const mergedCategories: Record<string, CategoryConfig> = {
        "non-frontier": {
          model: "openai/gpt-5.4",
        },
      };

      // when
      const config = maybeCreateSisyphusConfig({
        disabledAgents: [],
        agentOverrides,
        availableModels: new Set(["anthropic/claude-opus-4-7", "openai/gpt-5.4"]),
        systemDefaultModel: "anthropic/claude-opus-4-7",
        isFirstRunNoCache: false,
        availableAgents: [],
        availableSkills: [],
        availableCategories: [],
        mergedCategories,
        useTaskSystem: false,
      });

      // then
      expect(config?.model).toBe("openai/gpt-5.4");
      expect(config?.permission).not.toHaveProperty("grep");
      expect(config?.permission).not.toHaveProperty("glob");
    });
  });

  describe("#given non-frontier model with user override denying grep and glob", () => {
    test("#when config is created #then explicit user denies are preserved", () => {
      // given
      const agentOverrides: AgentOverrides = {
        sisyphus: {
          model: "openai/gpt-5.4",
          permission: {
            grep: "deny",
            glob: "deny",
          } as Record<string, "deny">,
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
      expect(config?.permission).toHaveProperty("grep", "deny");
      expect(config?.permission).toHaveProperty("glob", "deny");
    });
  });

  describe("#given non-frontier model with legacy user tools denying grep and glob", () => {
    test("#when config is created #then explicit legacy denies are preserved", () => {
      // given
      const legacyOverride = {
        model: "openai/gpt-5.4",
        tools: {
          grep: false,
          glob: false,
        },
      };
      const agentOverrides: AgentOverrides = {
        sisyphus: legacyOverride,
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
      expect(config?.permission).toHaveProperty("grep", "deny");
      expect(config?.permission).toHaveProperty("glob", "deny");
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
          } as Record<string, "allow">,
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
