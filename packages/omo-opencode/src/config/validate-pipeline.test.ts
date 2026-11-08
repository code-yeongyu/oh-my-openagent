import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { validatePluginConfig } from "./validate"

function withProjectConfig<T>(name: string, config: unknown, run: (project: string) => T): T {
  const home = process.env.HOME
  const ocxProfile = process.env.OCX_PROFILE
  const omoProfile = process.env.OMO_PROFILE
  const root = mkdtempSync(join(tmpdir(), `omo-config-validate-pipeline-${name}-`))
  const project = join(root, "project")

  try {
    process.env.HOME = root
    delete process.env.OCX_PROFILE
    delete process.env.OMO_PROFILE
    mkdirSync(join(project, ".omo"), { recursive: true })
    writeFileSync(
      join(project, ".omo", "omo.jsonc"),
      typeof config === "string" ? config : `${JSON.stringify(config)}\n`,
      "utf-8",
    )
    return run(project)
  } finally {
    rmSync(root, { recursive: true, force: true })
    if (home === undefined) delete process.env.HOME
    else process.env.HOME = home
    if (ocxProfile === undefined) delete process.env.OCX_PROFILE
    else process.env.OCX_PROFILE = ocxProfile
    if (omoProfile === undefined) delete process.env.OMO_PROFILE
    else process.env.OMO_PROFILE = omoProfile
  }
}

describe("validatePluginConfig pipeline", () => {
  it("#given unsafe own permission keys beside valid agent and TUI values #when validating #then ignores and reports the keys without crashing or dropping valid siblings", () => {
    withProjectConfig(
      "unsafe-own-keys",
      `{
        "[opencode]": {
          "agents": {
            "sisyphus": {
              "model": "provider/good",
              "permission": {
                "constructor": "deny",
                "prototype": "deny",
                "__proto__": { "polluted": true }
              }
            }
          },
          "tui": { "sidebar": { "enabled": false } }
        }
      }`,
      (project) => {
        const result = validatePluginConfig(project)

        expect(result.config.agents?.sisyphus?.model).toBe("provider/good")
        expect(result.config.tui?.sidebar.enabled).toBe(false)
        const permission = result.config.agents?.sisyphus?.permission ?? {}
        expect(Object.hasOwn(permission, "constructor")).toBe(false)
        expect(Object.hasOwn(permission, "prototype")).toBe(false)
        expect(Object.hasOwn(permission, "__proto__")).toBe(false)
        expect(result.messages.join("\n")).toContain("[opencode].agents.sisyphus.permission.constructor")
        expect(result.messages.join("\n")).toContain("[opencode].agents.sisyphus.permission.prototype")
        expect(result.messages.join("\n")).toContain("[opencode].agents.sisyphus.permission.__proto__")
        expect(Reflect.get({}, "polluted")).toBeUndefined()
      },
    )
  })

  it("#given a partially invalid omo opencode view #when validating #then retains valid sections and warns about the ignored value", () => {
    withProjectConfig("partial", {
      "[opencode]": {
        agents: { sisyphus: { model: 123 } },
        tui: { sidebar: { enabled: false } },
      },
    }, (project) => {
      const result = validatePluginConfig(project)

      expect(result.valid).toBe(true)
      expect(result.messages).toEqual([])
      expect(result.config.tui?.sidebar.enabled).toBe(false)
      expect(result.warnings).toEqual(["config: ~/project/.omo/omo.jsonc: [opencode].agents.sisyphus.model ignored (invalid value)"])
    })
  })

  it("#given one invalid agent field beside a valid sibling agent in the opencode block #when validating #then only that field is dropped and the sibling agent still applies", () => {
    withProjectConfig("sibling-agent", {
      "[opencode]": {
        agents: { sisyphus: { model: 123, prompt_append: "keep me" }, oracle: { model: "openai/gpt-6" } },
      },
    }, (project) => {
      const result = validatePluginConfig(project)

      expect(result.config.agents?.oracle?.model).toBe("openai/gpt-6")
      expect(result.config.agents?.sisyphus?.prompt_append).toBe("keep me")
      expect(result.config.agents?.sisyphus?.model).toBeUndefined()
      expect(result.warnings).toEqual(["config: ~/project/.omo/omo.jsonc: [opencode].agents.sisyphus.model ignored (invalid value)"])
    })
  })

  it("#given a valid model alias beside an invalid OpenCode model-input leaf #when validating #then resolves the alias after dropping only the invalid leaf", () => {
    withProjectConfig("alias-with-invalid-leaf", {
      models: { alias: { model: "provider/resolved" } },
      "[opencode]": {
        agents: { sisyphus: { model: "alias" } },
        categories: { quick: { model: "provider/quick", temperature: "hot" } },
      },
    }, (project) => {
      const result = validatePluginConfig(project)

      expect(result.config.agents?.sisyphus?.model).toBe("provider/resolved")
      expect(result.config.categories?.quick?.model).toBe("provider/quick")
      expect(result.warnings).toEqual([
        "config: ~/project/.omo/omo.jsonc: [opencode].categories.quick.temperature ignored (invalid value)",
      ])
    })
  })

  it("#given a valid category model beside an invalid legacy maxTokens value #when validating #then drops only maxTokens and preserves the category", () => {
    withProjectConfig("legacy-max-tokens", {
      categories: { quick: { model: "provider/quick", maxTokens: "bad" } },
    }, (project) => {
      const result = validatePluginConfig(project)

      expect(result.config.categories?.quick?.model).toBe("provider/quick")
      expect(result.config.categories?.quick?.maxTokens).toBeUndefined()
      expect(result.warnings).toEqual([
        "config: ~/project/.omo/omo.jsonc: categories.quick.maxTokens ignored (invalid value)",
      ])
    })
  })

  it("#given canonical max_tokens beside an invalid legacy maxTokens value #when validating #then keeps the category and reports only the invalid legacy leaf", () => {
    withProjectConfig("canonical-and-invalid-legacy-max-tokens", {
      categories: { quick: { model: "provider/quick", max_tokens: 4096, maxTokens: "bad" } },
    }, (project) => {
      const result = validatePluginConfig(project)

      expect(result.config.categories?.quick?.model).toBe("provider/quick")
      expect(result.warnings).toEqual([
        "config: ~/project/.omo/omo.jsonc: categories.quick.maxTokens ignored (invalid value)",
      ])
    })
  })

  it("#given an invalid shared task value beside a valid one #when validating #then the loader's ignored key is reported as a warning, not a failure", () => {
    withProjectConfig("shared-task", {
      task: { host_engine_policy: "sometimes", default_concurrency: 3 },
      "[opencode]": { tui: { sidebar: { enabled: false } } },
    }, (project) => {
      const result = validatePluginConfig(project)

      expect(result.valid).toBe(true)
      expect(result.config.tui?.sidebar.enabled).toBe(false)
      expect(result.warnings).toEqual(["config: ~/project/.omo/omo.jsonc: task.host_engine_policy ignored (invalid value)"])
    })
  })

  it("#given a disabled provider in an omo opencode view #when validating #then substitutes its allowed fallback", () => {
    withProjectConfig("disabled-provider", {
      "[opencode]": {
        disabled_providers: ["blocked"],
        agents: { sisyphus: { model: "blocked/primary", fallback_models: ["allowed/fallback"] } },
      },
    }, (project) => {
      const result = validatePluginConfig(project)

      expect(result.config.agents?.sisyphus?.model).toBe("allowed/fallback")
    })
  })

  it("#given a legacy ralph_loop omo opencode view #when validating #then migrates it to goal", () => {
    withProjectConfig("ralph-loop", {
      "[opencode]": { ralph_loop: { enabled: true, default_max_iterations: 50 } },
    }, (project) => {
      const result = validatePluginConfig(project)

      expect(result.config.goal).toMatchObject({ enabled: true, auto_start: false, default_max_iterations: 50 })
    })
  })

  it("#given explicit goal settings beside ralph_loop #when validating #then preserves explicit goal values", () => {
    withProjectConfig("goal-override", {
      "[opencode]": {
        goal: { enabled: false, default_max_iterations: 75 },
        ralph_loop: { enabled: true, default_max_iterations: 50 },
      },
    }, (project) => {
      const result = validatePluginConfig(project)

      expect(result.config.goal?.enabled).toBe(false)
      expect(result.config.goal?.default_max_iterations).toBe(75)
    })
  })
})
