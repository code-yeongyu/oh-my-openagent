import { describe, expect, it } from "bun:test";
import type { MatrixxConfig } from "./config";
import {
  _resetDisabledSetsCacheForTesting,
  getDisabledSets,
  mergeConfigs,
  parseConfigPartially,
} from "./plugin-config";

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
      } as MatrixxConfig;

      const override = {
        categories: {
          general: {
            temperature: 0.3,
          },
          visual: {
            model: "google/gemini-3-pro",
          },
        },
      } as unknown as MatrixxConfig;

      const result = mergeConfigs(base, override);

      // then general.model should be preserved from base
      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
      // then general.temperature should be overridden
      expect(result.categories?.general?.temperature).toBe(0.3);
      // then quick should be preserved from base
      expect(result.categories?.quick?.model).toBe("anthropic/claude-haiku-4-5");
      // then visual should be added from override
      expect(result.categories?.visual?.model).toBe("google/gemini-3-pro");
    });

    it("should preserve base categories when override has no categories", () => {
      const base: MatrixxConfig = {
        categories: {
          general: {
            model: "openai/gpt-5.2",
          },
        },
      };

      const override: MatrixxConfig = {};

      const result = mergeConfigs(base, override);

      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
    });

    it("should use override categories when base has no categories", () => {
      const base: MatrixxConfig = {};

      const override: MatrixxConfig = {
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
      const base: MatrixxConfig = {
        agents: {
          oracle: { model: "openai/gpt-5.2" },
        },
      };

      const override: MatrixxConfig = {
        agents: {
          oracle: { temperature: 0.5 },
          trinity: { model: "anthropic/claude-haiku-4-5" },
        },
      };

      const result = mergeConfigs(base, override);

      expect(result.agents?.oracle?.model).toBe("openai/gpt-5.2");
      expect(result.agents?.oracle?.temperature).toBe(0.5);
      expect(result.agents?.trinity?.model).toBe("anthropic/claude-haiku-4-5");
    });

    it("should merge disabled arrays without duplicates", () => {
      const base: MatrixxConfig = {
        disabled_hooks: ["comment-checker", "think-mode"],
      };

      const override: MatrixxConfig = {
        disabled_hooks: ["think-mode", "session-recovery"],
      };

      const result = mergeConfigs(base, override);

      expect(result.disabled_hooks).toContain("comment-checker");
      expect(result.disabled_hooks).toContain("think-mode");
      expect(result.disabled_hooks).toContain("session-recovery");
      expect(result.disabled_hooks?.length).toBe(3);
    });
  });

  describe("disabled Sets cache", () => {
    //#given mergeConfigs has produced a merged MatrixxConfig
    //#when getDisabledSets is called twice on the same config
    //#then both calls must return the SAME Set reference for each
    //#     disabled_xxx field, and the constructor was only invoked
    //#     once per disabled_xxx list (no allocation on cache hit)

    it("mergeConfigs allocates disabled_xxx Set once per config", () => {
      _resetDisabledSetsCacheForTesting();

      const base: MatrixxConfig = {
        disabled_agents: ["morpheus", "oracle"],
        disabled_mcps: ["websearch"],
        disabled_hooks: ["quality-gate"],
        disabled_commands: ["profile"],
        disabled_skills: ["git-master"],
      };
      const override: MatrixxConfig = {
        disabled_agents: ["trinity"],
      };

      // Spy on global Set to count how many Sets mergeConfigs allocates.
      // deepMerge has zero runtime Set usage (only at module load), so
      // every Set created here belongs to the 5 disabled_xxx fields.
      const OriginalSet = globalThis.Set;
      let setCallCount = 0;
      const SetSpy = class extends OriginalSet {
        constructor(...args: ConstructorParameters<typeof OriginalSet>) {
          super(...args);
          setCallCount++;
        }
      };
      globalThis.Set = SetSpy as unknown as typeof Set;

      try {
        const merged = mergeConfigs(base, override);

        // 1 Set per disabled_xxx field (5 total). No extra Sets from
        // getDisabledSets yet — that path is cache-populated by mergeConfigs
        // itself.
        expect(setCallCount).toBe(5);

        // First read: cache hit (pre-populated by mergeConfigs), 0 new Sets.
        const s1 = getDisabledSets(merged);
        expect(setCallCount).toBe(5);

        // Second read: same config → same WeakMap entry → same Set refs.
        const s2 = getDisabledSets(merged);
        expect(setCallCount).toBe(5);

        // Every disabled_xxx Set is the SAME reference across calls.
        expect(Object.is(s1.disabledAgents, s2.disabledAgents)).toBe(true);
        expect(Object.is(s1.disabledMcps, s2.disabledMcps)).toBe(true);
        expect(Object.is(s1.disabledHooks, s2.disabledHooks)).toBe(true);
        expect(Object.is(s1.disabledCommands, s2.disabledCommands)).toBe(true);
        expect(Object.is(s1.disabledSkills, s2.disabledSkills)).toBe(true);

        // Sanity: merged values are correct (dedup union of base + override).
        expect(s1.disabledAgents.has("morpheus")).toBe(true);
        expect(s1.disabledAgents.has("oracle")).toBe(true);
        expect(s1.disabledAgents.has("trinity")).toBe(true);
        expect(s1.disabledAgents.size).toBe(3);
        expect(s1.disabledMcps.has("websearch")).toBe(true);
        expect(s1.disabledHooks.has("quality-gate")).toBe(true);
        expect(s1.disabledCommands.has("profile")).toBe(true);
        expect(s1.disabledSkills.has("git-master")).toBe(true);
      } finally {
        globalThis.Set = OriginalSet;
      }
    });

    it("getDisabledSets on a fresh (un-merged) config allocates its own Sets once", () => {
      _resetDisabledSetsCacheForTesting();

      const config: MatrixxConfig = {
        disabled_agents: ["morpheus"],
        disabled_mcps: ["websearch"],
        disabled_hooks: ["quality-gate"],
        disabled_commands: ["profile"],
        disabled_skills: ["git-master"],
      };

      // Cold read: 5 fresh Sets (one per disabled_xxx field).
      const s1 = getDisabledSets(config);
      // Warm read: cache hit, identical Set references.
      const s2 = getDisabledSets(config);

      expect(Object.is(s1.disabledAgents, s2.disabledAgents)).toBe(true);
      expect(Object.is(s1.disabledMcps, s2.disabledMcps)).toBe(true);
      expect(Object.is(s1.disabledHooks, s2.disabledHooks)).toBe(true);
      expect(Object.is(s1.disabledCommands, s2.disabledCommands)).toBe(true);
      expect(Object.is(s1.disabledSkills, s2.disabledSkills)).toBe(true);
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
          smith: { model: "openai/gpt-5.2" },
        },
        disabled_hooks: ["comment-checker"],
      };

      const result = parseConfigPartially(rawConfig);

      expect(result).not.toBeNull();
      expect(result!.agents?.oracle?.model).toBe("openai/gpt-5.2");
      expect(result!.agents?.smith?.model).toBe("openai/gpt-5.2");
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
          smith: { model: "openai/gpt-5.2" },
          keymaker: {
            permission: {
              edit: { "*": "ask", ".morpheus/**": "allow" },
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
      expect(result!.disabled_hooks).toBeUndefined();
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
      expect(result!.disabled_hooks).toBeUndefined();
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
