import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { BUILTIN_AGENTS } from "@oh-my-opencode/senpi-task/agents-builtin"

import { NATIVE_AGENT_NAMES } from "../bin/lib/setup-opencode-models.js"
import { teardownRoots } from "./teardown.test-support"

// The real launcher, not a copy: the stage reads the engine's model catalog through the installed senpi.
const LAUNCHER = resolve(fileURLToPath(new URL("../bin/omo.js", import.meta.url)))
const roots: string[] = []

afterEach(() => teardownRoots(roots))

type Sandbox = { root: string, home: string, agentDir: string, opencodeDir: string, omoConfig: string, settings: string }

function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "omo-model-choices-"))
  roots.push(root)
  const home = join(root, "home")
  mkdirSync(home, { recursive: true })
  return {
    root,
    home,
    agentDir: join(home, ".omo", "agent"),
    opencodeDir: join(home, ".config", "opencode"),
    omoConfig: join(home, ".omo", "omo.jsonc"),
    settings: join(home, ".omo", "agent", "settings.json"),
  }
}

function write(path: string, content: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2))
}

function run(item: Sandbox, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: item.home, USERPROFILE: item.home }
  for (const name of Object.keys(env)) {
    if (/^(OMO_|SENPI_|PI_|OPENCODE_|XDG_)/.test(name) || name.endsWith("_CODING_AGENT_DIR")) delete env[name]
  }
  const result = spawnSync(process.execPath, [LAUNCHER, ...args], { encoding: "utf8", env })
  if (result.error) throw result.error
  expect(result.status).toBe(0)
  return result.stdout
}

function nativeView(item: Sandbox, harness: "native" | "opencode" = "native") {
  return loadOmoConfig({ cwd: item.home, env: { HOME: item.home }, harness, platform: "linux" })
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"))
}

// The issue's reproduction: provider ids only opencode spells (kimi-for-coding, zai-coding-plan).
function issueUser(item: Sandbox): void {
  write(join(item.opencodeDir, "opencode.jsonc"), `{
    // opencode's own defaults
    "model": "kimi-for-coding/k3",
    "small_model": "opencode-go/glm-5.2",
    "agent": { "build": { "model": "opencode-go/kimi-k3" }, "explore": { "model": "zai-coding-plan/glm-5.2" } },
  }`)
  write(join(item.opencodeDir, "oh-my-openagent.json"), {
    agents: { oracle: { model: "opencode-go/kimi-k3" }, librarian: { model: "zai-coding-plan/glm-5.2" } },
    categories: {
      quick: { model: "opencode-go/glm-5.2" },
      "deep-low": { model: "kimi-for-coding/k3", fallback_models: ["opencode-go/kimi-k3", "opencode-go/no-such-model"], variant: "max" },
    },
  })
}

describe("omo setup model choices", () => {
  describe("#given the issue's opencode default model, agent overrides and OpenCode-edition routing", () => {
    test("#when setup is accepted #then the native harness loader sees the translated routing and the engine default is set", () => {
      // given
      const item = sandbox()
      issueUser(item)

      // when
      const stdout = run(item, ["setup", "--yes"])
      const loaded = nativeView(item)

      // then
      expect(loaded.diagnostics).toEqual([])
      expect(loaded.config.model_profile).toBe("kimi-coding/k3")
      expect(loaded.config.categories?.quick).toEqual({ model: "opencode-go/glm-5.2" })
      expect(loaded.config.categories?.["deep-low"]).toEqual({ models: ["kimi-coding/k3", "opencode-go/kimi-k3"], reasoning: "max" })
      expect(loaded.config.agents?.librarian?.model).toBe("zai/glm-5.2")
      expect(loaded.config.agents?.explore?.model).toBe("zai/glm-5.2")
      expect(loaded.config.agents?.oracle).toBeUndefined()
      // In the [native] block, not the shared base: the OpenCode plugin's own view is unchanged.
      expect(nativeView(item, "opencode").config.categories?.quick).toBeUndefined()
      expect(readJson(item.settings)).toEqual({ defaultProvider: "kimi-coding", defaultModel: "k3" })
      expect(stdout).toContain("model-choices-carried: default model, model_profile, category deep-low, category quick, agent explore, agent librarian")
      expect(stdout).toContain("model-choices-not-carried: 4")
    })
  })

  describe("#given model choices setup already carried", () => {
    test("#when setup runs again #then no file changes and no backup is made", () => {
      // given
      const item = sandbox()
      issueUser(item)
      run(item, ["setup", "--yes"])
      const before = [readFileSync(item.omoConfig, "utf8"), readFileSync(item.settings, "utf8")]

      // when
      const stdout = run(item, ["setup", "--yes"])

      // then
      expect([readFileSync(item.omoConfig, "utf8"), readFileSync(item.settings, "utf8")]).toEqual(before)
      expect(readdirSync(join(item.home, ".omo")).filter((name) => name.includes(".bak-"))).toEqual([])
      expect(stdout).toContain("model-choices-carried: none")
    })
  })

  describe("#given a dry run", () => {
    test("#when setup previews #then neither omo.jsonc nor settings.json is written", () => {
      // given
      const item = sandbox()
      issueUser(item)

      // when: --yes as well, so only the dry run (not a refused prompt) keeps the files unwritten
      const stdout = run(item, ["setup", "--dry-run", "--yes"])

      // then
      expect(existsSync(item.omoConfig)).toBe(false)
      expect(existsSync(item.settings)).toBe(false)
      expect(stdout).toContain("planned-model-choices: default model, model_profile, category deep-low, category quick, agent explore, agent librarian")
    })
  })

  describe("#given an existing commented omo.jsonc and settings.json the user wrote", () => {
    test("#when setup is accepted #then existing keys and comments are kept, new ones are added and the edited file is backed up", () => {
      // given
      const item = sandbox()
      issueUser(item)
      const original = `{
  // keep me
  "categories": { "quick": { "model": "anthropic/claude-haiku-4-5" } },
  "[native]": { "telemetry": { "enabled": false } },
}
`
      write(item.omoConfig, original)
      write(item.settings, { defaultProvider: "anthropic", defaultModel: "claude-opus-5-5" })

      // when
      const stdout = run(item, ["setup", "--yes"])
      const loaded = nativeView(item)

      // then
      expect(readFileSync(item.omoConfig, "utf8")).toContain("// keep me")
      expect(loaded.config.categories?.quick?.model).toBe("anthropic/claude-haiku-4-5")
      expect(loaded.config.categories?.["deep-low"]?.models?.[0]).toBe("kimi-coding/k3")
      expect(loaded.config.telemetry?.enabled).toBe(false)
      expect(readJson(item.settings)).toEqual({ defaultProvider: "anthropic", defaultModel: "claude-opus-5-5" })
      expect(readdirSync(join(item.home, ".omo")).filter((name) => name.startsWith("omo.jsonc.bak-"))).toHaveLength(1)
      expect(readFileSync(join(item.home, ".omo", readdirSync(join(item.home, ".omo")).find((name) => name.startsWith("omo.jsonc.bak-"))!), "utf8")).toBe(original)
      expect(stdout).toContain("model-choices-skipped-existing: default model, category quick")
    })
  })

  describe("#given an opencode default model on openai signed in with a ChatGPT OAuth login", () => {
    test("#when setup is accepted #then it is carried to the provider setup tells the user to /login to", () => {
      // given
      const item = sandbox()
      write(join(item.home, ".local", "share", "opencode", "auth.json"), { openai: { type: "oauth", refresh: "r", access: "a", expires: 1 } })
      write(join(item.opencodeDir, "opencode.json"), { model: "openai/gpt-5.5" })

      // when
      const stdout = run(item, ["setup", "--yes"])

      // then
      expect(stdout).toContain("/login chatgpt-subscription")
      expect(readJson(item.settings)).toEqual({ defaultProvider: "chatgpt-subscription", defaultModel: "gpt-5.5" })
      expect(nativeView(item).config.model_profile).toBe("chatgpt-subscription/gpt-5.5")
    })
  })

  describe("#given an omo.jsonc only its owner may read", () => {
    test.skipIf(process.platform === "win32")("#when setup edits it #then it stays mode 0600", () => {
      // given
      const item = sandbox()
      issueUser(item)
      write(item.omoConfig, `{ "secret": "tok-$&-!x" }\n`)
      chmodSync(item.omoConfig, 0o600)

      // when
      run(item, ["setup", "--yes"])

      // then
      expect(nativeView(item).config.categories?.quick?.model).toBe("opencode-go/glm-5.2")
      expect(statSync(item.omoConfig).mode & 0o777).toBe(0o600)
    })
  })

  describe("#given model strings the engine cannot serve", () => {
    test("#when setup is accepted #then each one is reported with its reason and none is written", () => {
      // given
      const item = sandbox()
      write(join(item.opencodeDir, "opencode.json"), { model: "nowhere/some-model" })
      write(join(item.opencodeDir, "oh-my-openagent.json"), {
        categories: { quick: { model: "kimi-for-coding/no-such-model", reasoning: "high" }, writing: { model: "nowhere/x" } },
      })

      // when
      const stdout = run(item, ["setup", "--yes"])

      // then
      expect(existsSync(item.omoConfig)).toBe(false)
      expect(existsSync(item.settings)).toBe(false)
      expect(stdout).toContain("model choice not carried: default model nowhere/some-model: provider nowhere is not one omo serves or was carried over")
      expect(stdout).toContain("model choice not carried: category quick model kimi-for-coding/no-such-model: omo's kimi-coding provider has no model no-such-model")
      expect(stdout).toContain("model-choices-not-carried: 3")
    })
  })

  describe("#given a default model on an opencode custom provider", () => {
    test("#when setup is accepted #then it validates against the provider the custom-provider stage carried", () => {
      // given
      const item = sandbox()
      write(join(item.opencodeDir, "opencode.json"), {
        model: "acme/acme-large",
        provider: { acme: { options: { baseURL: "https://api.acme.example/v1", apiKey: "k" }, models: { "acme-large": {} } } },
      })

      // when
      run(item, ["setup", "--yes"])

      // then
      expect(readJson(item.settings)).toEqual({ defaultProvider: "acme", defaultModel: "acme-large" })
      expect(nativeView(item).config.model_profile).toBe("acme/acme-large")
    })
  })

  describe("#given OpenCode-edition routing the config migration already moved", () => {
    test("#when setup is accepted #then it reads the [opencode] block and the migration backup copy", () => {
      // given
      const item = sandbox()
      write(item.omoConfig, { "[opencode]": { categories: { quick: { model: "opencode-go/glm-5.2" } } } })
      write(join(item.home, ".omo", "migration-backup-2026-09-24T00-00-00-000Z-opencode-config", ".config", "opencode", "oh-my-openagent.json"), {
        categories: { quick: { model: "zai-coding-plan/glm-5.2" }, writing: { model: "kimi-for-coding/k3" } },
      })

      // when
      run(item, ["setup", "--yes"])
      const loaded = nativeView(item)

      // then
      expect(loaded.config.categories?.quick?.model).toBe("opencode-go/glm-5.2")
      expect(loaded.config.categories?.writing?.model).toBe("kimi-coding/k3")
    })
  })

  describe("#given OpenCode-edition models for the metis and momus plan agents", () => {
    test("#when setup is accepted #then they are carried to the native plan-consultant and plan-reviewer", () => {
      // given
      const item = sandbox()
      write(join(item.opencodeDir, "oh-my-openagent.json"), {
        agents: { metis: { model: "zai-coding-plan/glm-5.2" }, momus: { model: "kimi-for-coding/k3", variant: "high" } },
      })

      // when
      const stdout = run(item, ["setup", "--yes"])
      const loaded = nativeView(item)

      // then
      expect(loaded.diagnostics).toEqual([])
      expect(loaded.config.agents?.["plan-consultant"]).toEqual({ model: "zai/glm-5.2" })
      expect(loaded.config.agents?.["plan-reviewer"]).toEqual({ model: "kimi-coding/k3", reasoning: "high" })
      expect(loaded.config.agents?.metis).toBeUndefined()
      expect(loaded.config.agents?.momus).toBeUndefined()
      expect(stdout).toContain("model-choices-carried: agent plan-consultant, agent plan-reviewer")
    })

    test("#when the same file also sets the native agent #then the native name wins over its OpenCode-edition alias", () => {
      // given
      const item = sandbox()
      write(join(item.opencodeDir, "oh-my-openagent.json"), {
        agents: { metis: { model: "zai-coding-plan/glm-5.2" }, "plan-consultant": { model: "opencode-go/glm-5.2" } },
      })

      // when
      run(item, ["setup", "--yes"])

      // then
      expect(nativeView(item).config.agents?.["plan-consultant"]).toEqual({ model: "opencode-go/glm-5.2" })
    })
  })

  describe("#given the native harness's builtin agents", () => {
    test("#when the names setup may carry are compared #then they are exactly senpi-task's builtins", () => {
      expect([...NATIVE_AGENT_NAMES].sort()).toEqual(Object.keys(BUILTIN_AGENTS).sort())
    })
  })
})
