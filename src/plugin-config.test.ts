import { describe, expect, it } from "bun:test";
import {
  detectLikelyBuiltinAgentTypos,
  detectUnknownBuiltinAgentKeys,
  mergeConfigs,
  parseConfigPartially,
} from "./plugin-config";
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
            model: "google/gemini-3.1-pro",
          },
        },
      } as unknown as OhMyOpenCodeConfig;

      const result = mergeConfigs(base, override);

      // then general.model should be preserved from base
      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
      // then general.temperature should be overridden
      expect(result.categories?.general?.temperature).toBe(0.3);
      // then quick should be preserved from base
      expect(result.categories?.quick?.model).toBe("anthropic/claude-haiku-4-5");
      // then visual should be added from override
      expect(result.categories?.visual?.model).toBe("google/gemini-3.1-pro");
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

    it("should deep merge custom_agents", () => {
      const base: OhMyOpenCodeConfig = {
        custom_agents: {
          translator: { model: "google/gemini-3-flash-preview" },
        },
      }

      const override: OhMyOpenCodeConfig = {
        custom_agents: {
          translator: { temperature: 0 },
          "database-architect": { model: "openai/gpt-5.3-codex" },
        },
      }

      const result = mergeConfigs(base, override)

      expect(result.custom_agents?.translator?.model).toBe("google/gemini-3-flash-preview")
      expect(result.custom_agents?.translator?.temperature).toBe(0)
      expect(result.custom_agents?.["database-architect"]?.model).toBe("openai/gpt-5.3-codex")
    })
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
      expect(result!.agents?.oracle?.model).toBe("openai/gpt-5.2");
      expect(result!.agents?.momus?.model).toBe("openai/gpt-5.2");
      expect((result!.agents as Record<string, unknown>)?.prometheus).toBeUndefined();
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

    it("should preserve valid built-in agent entries when agents contains unknown keys", () => {
      const rawConfig = {
        agents: {
          sisyphus: { model: "openai/gpt-5.3-codex" },
          sisyphuss: { model: "openai/gpt-5.3-codex" },
        },
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.agents?.sisyphus?.model).toBe("openai/gpt-5.3-codex");
      expect((result!.agents as Record<string, unknown>)?.sisyphuss).toBeUndefined();
    });

    it("should preserve valid custom_agents entries when custom_agents contains reserved names", () => {
      const rawConfig = {
        custom_agents: {
          translator: { model: "google/gemini-3-flash-preview" },
          sisyphus: { model: "openai/gpt-5.3-codex" },
        },
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.custom_agents?.translator?.model).toBe("google/gemini-3-flash-preview");
      expect((result!.custom_agents as Record<string, unknown>)?.sisyphus).toBeUndefined();
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
      expect((result as Record<string, unknown>)["some_future_key"]).toBeUndefined();
    });
  });
});

describe("detectLikelyBuiltinAgentTypos", () => {
  it("detects near-miss builtin agent keys", () => {
    const rawConfig = {
      agents: {
        sisyphuss: { model: "openai/gpt-5.2" },
      },
    }

    const warnings = detectLikelyBuiltinAgentTypos(rawConfig)

    expect(warnings).toEqual([
      {
        key: "sisyphuss",
        suggestion: "sisyphus",
      },
    ])
  })

  it("suggests canonical key casing for OpenCode-Builder typos", () => {
    const rawConfig = {
      agents: {
        "opencode-buildr": { model: "openai/gpt-5.2" },
      },
    }

    const warnings = detectLikelyBuiltinAgentTypos(rawConfig)

    expect(warnings).toEqual([
      {
        key: "opencode-buildr",
        suggestion: "OpenCode-Builder",
      },
    ])
  })

  it("does not flag valid custom agent names", () => {
    const rawConfig = {
      agents: {
        translator: { model: "google/gemini-3-flash-preview" },
      },
    }

    const warnings = detectLikelyBuiltinAgentTypos(rawConfig)

    expect(warnings).toEqual([])
  })
})

describe("detectUnknownBuiltinAgentKeys", () => {
  it("returns unknown keys under agents", () => {
    const rawConfig = {
      agents: {
        sisyphus: { model: "openai/gpt-5.2" },
        translator: { model: "google/gemini-3-flash-preview" },
      },
    }

    const unknownKeys = detectUnknownBuiltinAgentKeys(rawConfig)

    expect(unknownKeys).toEqual(["translator"])
  })

  it("returns empty array when all keys are built-ins", () => {
    const rawConfig = {
      agents: {
        sisyphus: { model: "openai/gpt-5.2" },
        prometheus: { model: "openai/gpt-5.2" },
      },
    }

    const unknownKeys = detectUnknownBuiltinAgentKeys(rawConfig)

    expect(unknownKeys).toEqual([])
  })

  it("excludes typo keys when explicitly provided", () => {
    const rawConfig = {
      agents: {
        sisyphuss: { model: "openai/gpt-5.2" },
        translator: { model: "google/gemini-3-flash-preview" },
      },
    }

    const unknownKeys = detectUnknownBuiltinAgentKeys(rawConfig, ["sisyphuss"])

    expect(unknownKeys).toEqual(["translator"])
  })

  it("excludes typo keys case-insensitively", () => {
    const rawConfig = {
      agents: {
        Sisyphuss: { model: "openai/gpt-5.2" },
        translator: { model: "google/gemini-3-flash-preview" },
      },
    }

    const unknownKeys = detectUnknownBuiltinAgentKeys(rawConfig, ["sisyphuss"])

    expect(unknownKeys).toEqual(["translator"])
  })
})
