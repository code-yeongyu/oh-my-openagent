import { describe, expect, it, test } from "bun:test";
import {
  mergeConfigs,
  parseConfigPartially,
  applyEnvVarOverrides,
} from "./plugin-config";
import { isClaudeCodeEnabled } from "./config/schema/claude-code";
import type { OhMyOpenCodeConfig } from "./config";

describe("mergeConfigs", () => {
  describe("categories merging", () => {
    // given base config has categories, override has different categories
    // when merging configs
    // then should deep merge categories, not override completely

    it("should deep merge categories from base and override", () => {
      const base = {
        categories: {
          general: {
            model: "openai/gpt-5.2",
            temperature: 0.5,
          },
          quick: {
            model: "anthropic/claude-haiku-4-5",
          },
        },
      } as OhMyOpenCodeConfig;

      const override = {
        categories: {
          general: {
            temperature: 0.3,
          },
          visual: {
            model: "google/gemini-3-pro",
          },
        },
      } as unknown as OhMyOpenCodeConfig;

      const result = mergeConfigs(base, override);

      // then general.model should be preserved from base
      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
      // then general.temperature should be overridden
      expect(result.categories?.general?.temperature).toBe(0.3);
      // then quick should be preserved from base
      expect(result.categories?.quick?.model).toBe(
        "anthropic/claude-haiku-4-5",
      );
      // then visual should be added from override
      expect(result.categories?.visual?.model).toBe("google/gemini-3-pro");
    });

    it("should preserve base categories when override has no categories", () => {
      const base: OhMyOpenCodeConfig = {
        categories: {
          general: {
            model: "openai/gpt-5.2",
          },
        },
      };

      const override: OhMyOpenCodeConfig = {};

      const result = mergeConfigs(base, override);

      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
    });

    it("should use override categories when base has no categories", () => {
      const base: OhMyOpenCodeConfig = {};

      const override: OhMyOpenCodeConfig = {
        categories: {
          general: {
            model: "openai/gpt-5.2",
          },
        },
      };

      const result = mergeConfigs(base, override);

      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
    });
  });

  describe("existing behavior preservation", () => {
    it("should deep merge agents", () => {
      const base: OhMyOpenCodeConfig = {
        agents: {
          oracle: { model: "openai/gpt-5.2" },
        },
      };

      const override: OhMyOpenCodeConfig = {
        agents: {
          oracle: { temperature: 0.5 },
          explore: { model: "anthropic/claude-haiku-4-5" },
        },
      };

      const result = mergeConfigs(base, override);

      expect(result.agents?.oracle?.model).toBe("openai/gpt-5.2");
      expect(result.agents?.oracle?.temperature).toBe(0.5);
      expect(result.agents?.explore?.model).toBe("anthropic/claude-haiku-4-5");
    });

    it("should merge disabled arrays without duplicates", () => {
      const base: OhMyOpenCodeConfig = {
        disabled_hooks: ["comment-checker", "think-mode"],
      };

      const override: OhMyOpenCodeConfig = {
        disabled_hooks: ["think-mode", "session-recovery"],
      };

      const result = mergeConfigs(base, override);

      expect(result.disabled_hooks).toContain("comment-checker");
      expect(result.disabled_hooks).toContain("think-mode");
      expect(result.disabled_hooks).toContain("session-recovery");
      expect(result.disabled_hooks?.length).toBe(3);
    });
  });
});

describe("parseConfigPartially", () => {
  describe("fully valid config", () => {
    //#given a config where all sections are valid
    //#when parsing the config
    //#then should return the full parsed config unchanged

    it("should return the full config when everything is valid", () => {
      const rawConfig = {
        agents: {
          oracle: { model: "openai/gpt-5.2" },
          momus: { model: "openai/gpt-5.2" },
        },
        disabled_hooks: ["comment-checker"],
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.agents?.oracle?.model).toBe("openai/gpt-5.2");
      expect(result!.agents?.momus?.model).toBe("openai/gpt-5.2");
      expect(result!.disabled_hooks).toEqual(["comment-checker"]);
    });
  });

  describe("partially invalid config", () => {
    //#given a config where one section is invalid but others are valid
    //#when parsing the config
    //#then should return valid sections and skip invalid ones

    it("should preserve valid agent overrides when another section is invalid", () => {
      const rawConfig = {
        agents: {
          oracle: { model: "openai/gpt-5.2" },
          momus: { model: "openai/gpt-5.2" },
          prometheus: {
            permission: {
              edit: { "*": "ask", ".sisyphus/**": "allow" },
            },
          },
        },
        disabled_hooks: ["comment-checker"],
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.disabled_hooks).toEqual(["comment-checker"]);
      expect(result!.agents).toBeUndefined();
    });

    it("should preserve valid agents when a non-agent section is invalid", () => {
      const rawConfig = {
        agents: {
          oracle: { model: "openai/gpt-5.2" },
        },
        disabled_hooks: ["not-a-real-hook"],
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.agents?.oracle?.model).toBe("openai/gpt-5.2");
      expect(result!.disabled_hooks).toEqual(["not-a-real-hook"]);
    });
  });

  describe("completely invalid config", () => {
    //#given a config where all sections are invalid
    //#when parsing the config
    //#then should return an empty object (not null)

    it("should return empty object when all sections are invalid", () => {
      const rawConfig = {
        agents: { oracle: { temperature: "not-a-number" } },
        disabled_hooks: ["not-a-real-hook"],
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.agents).toBeUndefined();
      expect(result!.disabled_hooks).toEqual(["not-a-real-hook"]);
    });
  });

  describe("empty config", () => {
    //#given an empty config object
    //#when parsing the config
    //#then should return an empty object (fast path - full parse succeeds)

    it("should return empty object for empty input", () => {
      const result = parseConfigPartially({});

      expect(result).not.toBeNull();
      expect(Object.keys(result!).length).toBe(0);
    });
  });

  describe("unknown keys", () => {
    //#given a config with keys not in the schema
    //#when parsing the config
    //#then should silently ignore unknown keys and preserve valid ones

    it("should ignore unknown keys and return valid sections", () => {
      const rawConfig = {
        agents: {
          oracle: { model: "openai/gpt-5.2" },
        },
        some_future_key: { foo: "bar" },
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.agents?.oracle?.model).toBe("openai/gpt-5.2");
      expect(
        (result as Record<string, unknown>)["some_future_key"],
      ).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// applyEnvVarOverrides
// ---------------------------------------------------------------------------

describe("applyEnvVarOverrides", () => {
  test("returns same reference when OPENCODE_DISABLE_CLAUDE_CODE is not set", () => {
    //#given
    const config: OhMyOpenCodeConfig = {};

    //#when
    const result = applyEnvVarOverrides(config, {});

    //#then
    expect(result).toBe(config);
  });

  test("disables all claude_code components when OPENCODE_DISABLE_CLAUDE_CODE=1", () => {
    //#given
    const config: OhMyOpenCodeConfig = {};

    //#when
    const result = applyEnvVarOverrides(config, {
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
    });

    //#then
    expect(result.claude_code?.enabled).toBe(false);
    expect(result.claude_code?.plugins).toBe(false);
    expect(result.claude_code?.commands).toBe(false);
    expect(result.claude_code?.skills).toBe(false);
    expect(result.claude_code?.agents).toBe(false);
    expect(result.claude_code?.mcp).toBe(false);
    expect(result.claude_code?.hooks).toBe(false);
  });

  test("disables all claude_code components when OPENCODE_DISABLE_CLAUDE_CODE=true", () => {
    //#given
    const config: OhMyOpenCodeConfig = {};

    //#when
    const result = applyEnvVarOverrides(config, {
      OPENCODE_DISABLE_CLAUDE_CODE: "true",
    });

    //#then
    expect(result.claude_code?.enabled).toBe(false);
    expect(result.claude_code?.plugins).toBe(false);
  });

  test("does not disable when OPENCODE_DISABLE_CLAUDE_CODE=0", () => {
    //#given
    const config: OhMyOpenCodeConfig = {};

    //#when
    const result = applyEnvVarOverrides(config, {
      OPENCODE_DISABLE_CLAUDE_CODE: "0",
    });

    //#then
    expect(result).toBe(config);
    expect(result.claude_code?.enabled).toBeUndefined();
  });

  test("env override wins over explicit claude_code.mcp=true in user config", () => {
    //#given
    const config: OhMyOpenCodeConfig = { claude_code: { mcp: true } };

    //#when
    const result = applyEnvVarOverrides(config, {
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
    });

    //#then
    expect(result.claude_code?.mcp).toBe(false);
  });

  test("preserves unrelated config fields and plugins_override after override", () => {
    //#given
    const config: OhMyOpenCodeConfig = {
      disabled_mcps: ["some-server"] as any,
      claude_code: { plugins_override: { "my-plugin": true } },
    };

    //#when
    const result = applyEnvVarOverrides(config, {
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
    });

    //#then
    expect(result.disabled_mcps).toEqual(["some-server"]);
    expect(result.claude_code?.plugins_override).toEqual({ "my-plugin": true });
  });

  test("does not mutate the original config object", () => {
    //#given
    const config: OhMyOpenCodeConfig = { claude_code: { mcp: true } };
    const originalClaudeCode = config.claude_code;

    //#when
    applyEnvVarOverrides(config, { OPENCODE_DISABLE_CLAUDE_CODE: "1" });

    //#then — original is unchanged
    expect(config.claude_code).toBe(originalClaudeCode);
    expect(config.claude_code?.mcp).toBe(true);
  });

  // --- case-insensitive parsing ---

  test("treats OPENCODE_DISABLE_CLAUDE_CODE=TRUE (uppercase) as truthy", () => {
    const result = applyEnvVarOverrides({}, {
      OPENCODE_DISABLE_CLAUDE_CODE: "TRUE",
    });
    expect(result.claude_code?.enabled).toBe(false);
  });

  test("treats OPENCODE_DISABLE_CLAUDE_CODE=True (mixed case) as truthy", () => {
    const result = applyEnvVarOverrides({}, {
      OPENCODE_DISABLE_CLAUDE_CODE: "True",
    });
    expect(result.claude_code?.enabled).toBe(false);
  });

  test("does not disable for non-truthy values like empty string or 'yes'", () => {
    const config: OhMyOpenCodeConfig = {};
    expect(applyEnvVarOverrides(config, { OPENCODE_DISABLE_CLAUDE_CODE: "" })).toBe(config);
    expect(applyEnvVarOverrides(config, { OPENCODE_DISABLE_CLAUDE_CODE: "yes" })).toBe(config);
    expect(applyEnvVarOverrides(config, { OPENCODE_DISABLE_CLAUDE_CODE: undefined })).toBe(config);
  });

  // --- OPENCODE_DISABLE_CLAUDE_CODE_SKILLS (per-component) ---

  test("disables only skills when OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1", () => {
    //#given
    const config: OhMyOpenCodeConfig = {};

    //#when
    const result = applyEnvVarOverrides(config, {
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    });

    //#then — skills disabled, rest untouched
    expect(result.claude_code?.skills).toBe(false);
    expect(result.claude_code?.plugins).toBeUndefined();
    expect(result.claude_code?.commands).toBeUndefined();
    expect(result.claude_code?.agents).toBeUndefined();
    expect(result.claude_code?.mcp).toBeUndefined();
    expect(result.claude_code?.hooks).toBeUndefined();
    expect(result.claude_code?.enabled).toBeUndefined();
  });

  test("skills env override wins over explicit claude_code.skills=true in config", () => {
    //#given
    const config: OhMyOpenCodeConfig = { claude_code: { skills: true } };

    //#when
    const result = applyEnvVarOverrides(config, {
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "true",
    });

    //#then
    expect(result.claude_code?.skills).toBe(false);
  });

  test("master switch takes precedence over per-component skills var", () => {
    //#given — both master and skills env vars set
    const config: OhMyOpenCodeConfig = {};

    //#when
    const result = applyEnvVarOverrides(config, {
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    });

    //#then — master disables everything, not just skills
    expect(result.claude_code?.enabled).toBe(false);
    expect(result.claude_code?.plugins).toBe(false);
    expect(result.claude_code?.skills).toBe(false);
  });

  test("does not disable skills when OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=0", () => {
    const config: OhMyOpenCodeConfig = {};
    const result = applyEnvVarOverrides(config, {
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "0",
    });
    expect(result).toBe(config);
  });
});

// ---------------------------------------------------------------------------
// isClaudeCodeEnabled
// ---------------------------------------------------------------------------

describe("isClaudeCodeEnabled", () => {
  test("returns true for all components when claude_code is undefined", () => {
    expect(isClaudeCodeEnabled(undefined, "plugins")).toBe(true);
    expect(isClaudeCodeEnabled(undefined, "mcp")).toBe(true);
    expect(isClaudeCodeEnabled(undefined, "skills")).toBe(true);
    expect(isClaudeCodeEnabled(undefined, "agents")).toBe(true);
    expect(isClaudeCodeEnabled(undefined, "commands")).toBe(true);
    expect(isClaudeCodeEnabled(undefined, "hooks")).toBe(true);
  });

  test("returns false for every component when enabled=false (master gate)", () => {
    const cc = { enabled: false as const };
    expect(isClaudeCodeEnabled(cc, "plugins")).toBe(false);
    expect(isClaudeCodeEnabled(cc, "commands")).toBe(false);
    expect(isClaudeCodeEnabled(cc, "skills")).toBe(false);
    expect(isClaudeCodeEnabled(cc, "agents")).toBe(false);
    expect(isClaudeCodeEnabled(cc, "mcp")).toBe(false);
    expect(isClaudeCodeEnabled(cc, "hooks")).toBe(false);
  });

  test("master gate takes priority even when component is explicitly true", () => {
    const cc = { enabled: false as const, mcp: true as const };
    expect(isClaudeCodeEnabled(cc, "mcp")).toBe(false);
  });

  test("returns per-component boolean when enabled is not false", () => {
    expect(isClaudeCodeEnabled({ mcp: false }, "mcp")).toBe(false);
    expect(isClaudeCodeEnabled({ mcp: true }, "mcp")).toBe(true);
    expect(isClaudeCodeEnabled({ plugins: false }, "plugins")).toBe(false);
    expect(isClaudeCodeEnabled({ skills: false }, "skills")).toBe(false);
  });

  test("defaults to true when component is absent but enabled is not false", () => {
    expect(isClaudeCodeEnabled({}, "hooks")).toBe(true);
    expect(isClaudeCodeEnabled({ enabled: true }, "skills")).toBe(true);
  });
});
