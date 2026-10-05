import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { ModelConfig } from "../../../node_modules/@code-yeongyu/senpi/dist/core/model-config.js"
import { composeModelProvider } from "../../../node_modules/@code-yeongyu/senpi/dist/core/provider-composer.js"
import { resolveConfigValue } from "../../../node_modules/@code-yeongyu/senpi/dist/core/resolve-config-value.js"
import { readAuthStore, writeAuthStore } from "../bin/lib/auth-store.js"
import { planOpencodeProviders } from "../bin/lib/setup-opencode-providers.js"
import { teardownRoots } from "./teardown.test-support"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []

afterEach(() => teardownRoots(roots))

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

type Fixture = { home: string, agentDir: string, configHome: string, dataHome: string, launcher: string }

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-providers-e2e-"))
  roots.push(root)
  const app = join(root, "app")
  mkdirSync(join(root, "home"), { recursive: true })
  cpSync(join(SOURCE_ROOT, "bin"), join(app, "bin"), { recursive: true })
  write(join(app, "package.json"), JSON.stringify({ name: "omo-ai", version: "test", type: "module" }))
  return {
    home: join(root, "home"),
    agentDir: join(root, "senpi-agent"),
    configHome: join(root, "config"),
    dataHome: join(root, "data"),
    launcher: join(app, "bin", "omo.js"),
  }
}

function opencode(item: Fixture, config: unknown, auth?: unknown): void {
  write(join(item.configHome, "opencode", "opencode.json"), JSON.stringify(config, null, 2))
  if (auth !== undefined) write(join(item.dataHome, "opencode", "auth.json"), JSON.stringify(auth))
}

function run(item: Fixture, args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: item.home,
    USERPROFILE: item.home,
    SENPI_CODING_AGENT_DIR: item.agentDir,
    XDG_CONFIG_HOME: item.configHome,
    XDG_DATA_HOME: item.dataHome,
  }
  delete env.OMO_CODING_AGENT_DIR
  delete env.PI_CODING_AGENT_DIR
  delete env.OPENCODE_CONFIG_DIR
  delete env.OPENCODE_CONFIG
  const result = spawnSync(process.execPath, [item.launcher, ...args], { encoding: "utf8", env })
  if (result.error) throw result.error
  return result
}

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8"))
}

const ACME = {
  npm: "@ai-sdk/openai-compatible",
  name: "Acme Inference",
  options: { baseURL: "https://api.acme.example/v1", apiKey: "{env:ACME_API_KEY}" },
  models: {
    "acme-large": { name: "Acme Large", limit: { context: 200000, output: 32000 } },
    "acme-alias": { id: "acme-upstream-7b" },
  },
}

describe("omo setup opencode custom provider import", () => {
  describe("#given openai-compatible and anthropic custom providers in the opencode config", () => {
    describe("#when setup is accepted", () => {
      test("#then the pinned engine's own loader composes them with the api, baseUrl and limits opencode declared", () => {
        const item = fixture()
        opencode(item, {
          provider: {
            acme: ACME,
            relay: {
              npm: "@ai-sdk/anthropic",
              options: { baseURL: "https://relay.example/anthropic/v1", apiKey: "relay-key" },
              models: { "claude-relay": { reasoning: true, modalities: { input: ["text", "image", "pdf"] } } },
            },
          },
        })

        const result = run(item, ["setup", "--yes"])
        const config = ModelConfig.loadSync(join(item.agentDir, "models.json"))
        const acme = composeModelProvider("acme", undefined, config, undefined).getModels()
        const relay = composeModelProvider("relay", undefined, config, undefined).getModels()

        expect(result.status).toBe(0)
        expect(config.getError()).toBeUndefined()
        expect(acme.map((model: any) => [model.id, model.api, model.baseUrl, model.contextWindow, model.maxTokens])).toEqual([
          ["acme-large", "openai-completions", "https://api.acme.example/v1", 200000, 32000],
          ["acme-alias", "openai-completions", "https://api.acme.example/v1", 128000, 16384],
        ])
        expect(acme[0].name).toBe("Acme Large")
        expect(config.getProvider("acme")?.models?.[1]?.upstreamModelId).toBe("acme-upstream-7b")
        expect(relay.map((model: any) => [model.id, model.api, model.baseUrl, model.reasoning, model.input])).toEqual([
          ["claude-relay", "anthropic-messages", "https://relay.example/anthropic", true, ["text", "image"]],
        ])
        expect(result.stdout).toContain("providers-imported: acme, relay")
      })
    })
  })

  describe("#given custom providers whose models name their own npm package or url", () => {
    describe("#when setup is accepted", () => {
      test("#then the engine sends each model to the endpoint opencode would", () => {
        const item = fixture()
        opencode(item, {
          provider: {
            gw: {
              options: { baseURL: "https://gw.example/v1" },
              models: { "gpt-x": {}, "claude-x": { provider: { npm: "@ai-sdk/anthropic" } } },
            },
            ant: {
              npm: "@ai-sdk/anthropic",
              options: { baseURL: "https://ant.example/v1" },
              models: { "claude-y": {}, "oai-y": { provider: { npm: "@ai-sdk/openai-compatible" } } },
            },
            split: {
              api: "https://split.example/v1",
              models: { a: {}, b: { provider: { api: "https://other.example/v1" } } },
            },
          },
        })

        const result = run(item, ["setup", "--yes"])
        const config = ModelConfig.loadSync(join(item.agentDir, "models.json"))
        const endpoints = ["ant", "gw", "split"].flatMap((id) => composeModelProvider(id, undefined, config, undefined).getModels()
          .map((model: any) => [`${id}/${model.id}`, model.api, model.baseUrl]))

        expect(result.status).toBe(0)
        expect(config.getError()).toBeUndefined()
        expect(endpoints).toEqual([
          ["ant/claude-y", "anthropic-messages", "https://ant.example"],
          ["ant/oai-y", "openai-completions", "https://ant.example/v1"],
          ["gw/gpt-x", "openai-completions", "https://gw.example/v1"],
          ["gw/claude-x", "anthropic-messages", "https://gw.example"],
          ["split/a", "openai-completions", "https://split.example/v1"],
          ["split/b", "openai-completions", "https://other.example/v1"],
        ])
      })
    })
  })

  describe("#given custom provider keys in every source opencode reads", () => {
    describe("#when setup is accepted", () => {
      test("#then auth.json holds one 0600 key per provider that the engine resolves to what opencode would send", async () => {
        const item = fixture()
        const literal = "sk-$HOME!${X}$$"
        opencode(item, {
          provider: {
            acme: ACME,
            inline: { options: { baseURL: "https://inline.example/v1", apiKey: literal }, models: { m: {} } },
            stored: { options: { baseURL: "https://stored.example/v1" }, models: { m: {} } },
            envonly: { env: ["ENVONLY_KEY"], options: { baseURL: "https://env.example/v1" }, models: { m: {} } },
          },
        }, {
          acme: { type: "api", key: "loses-to-config-apiKey" },
          stored: { type: "api", key: `stored-${literal}` },
        })

        const result = run(item, ["setup", "--yes"])
        const path = join(item.agentDir, "auth.json")
        const auth = readJson(path)
        const env = { ACME_API_KEY: "acme-from-env", ENVONLY_KEY: "env-only", HOME: "/nope", X: "nope" }

        expect(result.status).toBe(0)
        expect(Object.keys(auth).sort()).toEqual(["acme", "envonly", "inline", "stored"])
        expect(Object.values(auth).every((entry: any) => entry.type === "api_key")).toBe(true)
        expect(await resolveConfigValue(auth.acme.key, env)).toBe("acme-from-env")
        expect(await resolveConfigValue(auth.inline.key, env)).toBe(literal)
        expect(await resolveConfigValue(auth.stored.key, env)).toBe(`stored-${literal}`)
        expect(await resolveConfigValue(auth.envonly.key, env)).toBe("env-only")
        if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600)
        expect(result.stdout).not.toContain("skipped-unmapped: acme")
      })
    })
  })

  describe("#given providers omo cannot serve as custom providers", () => {
    describe("#when setup is accepted", () => {
      test("#then an unsupported npm package, a built-in provider override and a url only opencode can expand are reported by name and not written", () => {
        const item = fixture()
        opencode(item, {
          provider: {
            acme: ACME,
            gemini: { npm: "@ai-sdk/google", options: { baseURL: "https://g.example/v1beta" }, models: { g: {} } },
            openai: { options: { baseURL: "https://proxy.example/v1" }, models: { "gpt-x": {} } },
            hosted: { options: { baseURL: "https://${ACME_HOST}/v1" }, models: { h: {} } },
          },
        })

        const result = run(item, ["setup", "--yes"])

        expect(result.status).toBe(0)
        expect(Object.keys(readJson(join(item.agentDir, "models.json")).providers)).toEqual(["acme"])
        expect(result.stdout).toContain("@ai-sdk/google")
        expect(result.stdout).toContain("provider openai ")
        expect(result.stdout).toContain("custom provider hosted has no fixed baseURL")
        expect(result.stdout).toContain("providers-imported: acme\n")
        expect(planOpencodeProviders({ home: item.home, env: { XDG_CONFIG_HOME: item.configHome, XDG_DATA_HOME: item.dataHome } }).skipped).toEqual(["gemini", "hosted", "openai"])
      })
    })
  })

  describe("#given models.json and auth.json already hold entries of the same ids", () => {
    describe("#when setup runs twice", () => {
      test("#then existing entries stay byte-identical, the rest is added once with a backup, and the second run writes nothing", () => {
        const item = fixture()
        const mine = { baseUrl: "https://mine.example/v1", api: "openai-completions", models: [{ id: "mine" }] }
        write(join(item.agentDir, "models.json"), JSON.stringify({ providers: { acme: mine }, disabledProviders: ["x"] }))
        write(join(item.agentDir, "auth.json"), JSON.stringify({ fresh: { type: "api_key", key: "mine" } }))
        opencode(item, {
          provider: {
            acme: ACME,
            fresh: { options: { baseURL: "https://fresh.example/v1", apiKey: "theirs" }, models: { f: {} } },
          },
        })

        const first = run(item, ["setup", "--yes"])
        const models = readJson(join(item.agentDir, "models.json"))
        const backups = readdirSync(item.agentDir).filter((name) => name.includes(".bak-"))
        const bytes = ["models.json", "auth.json"].map((name) => readFileSync(join(item.agentDir, name), "utf8"))
        const second = run(item, ["setup", "--yes"])

        expect(first.status).toBe(0)
        expect(models.providers.acme).toEqual(mine)
        expect(models.providers.fresh.baseUrl).toBe("https://fresh.example/v1")
        expect(models.disabledProviders).toEqual(["x"])
        expect(readJson(join(item.agentDir, "auth.json")).fresh).toEqual({ type: "api_key", key: "mine" })
        expect(backups.some((name) => name.startsWith("models.json.bak-"))).toBe(true)
        expect(second.status).toBe(0)
        expect(["models.json", "auth.json"].map((name) => readFileSync(join(item.agentDir, name), "utf8"))).toEqual(bytes)
        expect(readdirSync(item.agentDir).filter((name) => name.includes(".bak-"))).toEqual(backups)
        expect(second.stdout).toContain("providers-imported: none")
        expect(second.stdout).toContain("providers-skipped-existing: 2")
      })
    })
  })

  describe("#given models.json is a symlink into a dotfiles checkout", () => {
    describe("#when setup is accepted", () => {
      // Creating a symlink on Windows needs a privilege CI runners do not hold.
      test.skipIf(process.platform === "win32")("#then the provider lands in the linked file and the link stays a link", () => {
        const item = fixture()
        const linked = join(dirname(item.agentDir), "dotfiles", "models.json")
        write(linked, JSON.stringify({ providers: {} }))
        mkdirSync(item.agentDir, { recursive: true })
        symlinkSync(linked, join(item.agentDir, "models.json"))
        opencode(item, { provider: { acme: ACME } })

        const result = run(item, ["setup", "--yes"])

        expect(result.status).toBe(0)
        expect(lstatSync(join(item.agentDir, "models.json")).isSymbolicLink()).toBe(true)
        expect(Object.keys(readJson(linked).providers)).toEqual(["acme"])
      })
    })
  })

  describe("#given the credential and provider stages both rewrite auth.json in the same millisecond", () => {
    describe("#when the second stage backs it up", () => {
      test("#then the backup still holds the bytes from before setup", () => {
        const item = fixture()
        const path = join(item.agentDir, "auth.json")
        const original = JSON.stringify({ mine: { type: "api_key", key: "mine" } })
        write(path, original)

        try {
          setSystemTime(new Date("2026-09-24T12:00:00.000Z"))
          writeAuthStore(path, readAuthStore(path), [{ provider: "openai", key: "sk-o" }])
          writeAuthStore(path, readAuthStore(path), [{ provider: "acme", key: "k" }])
        } finally {
          setSystemTime()
        }
        const backups = readdirSync(item.agentDir).filter((name) => name.startsWith("auth.json.bak-"))

        expect(backups).toHaveLength(1)
        expect(readFileSync(join(item.agentDir, backups[0]), "utf8")).toBe(original)
        expect(Object.keys(readJson(path)).sort()).toEqual(["acme", "mine", "openai"])
      })
    })
  })

  describe("#given a custom provider id the credential stage also imports a key for", () => {
    describe("#when setup is accepted", () => {
      test("#then the key the credential stage wrote in the same run is kept, not overwritten", () => {
        // claude-sdk-oauth maps to anthropic-subscription, which is not a builtin id to the provider stage.
        const item = fixture()
        const provider = { npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://x.example/v1", apiKey: "provider-key" }, models: { m: {} } }
        opencode(item, { provider: { "anthropic-subscription": provider } }, { "claude-sdk-oauth": { type: "api", key: "credential-key" } })

        const result = run(item, ["setup", "--yes"])

        expect(result.status).toBe(0)
        expect(readJson(join(item.agentDir, "auth.json"))).toEqual({ "anthropic-subscription": { type: "api_key", key: "credential-key" } })
        expect(result.stdout).toContain("provider-keys-imported: 0")
      })
    })
  })

  describe("#given a custom provider and no consent", () => {
    describe("#when setup is a dry run or runs non-interactively without --yes", () => {
      test("#then the provider is previewed and nothing is written", () => {
        const item = fixture()
        opencode(item, { provider: { acme: ACME } })

        // --yes alongside --dry-run: only the dry-run guard stands between the preview and a write.
        const dry = run(item, ["setup", "--dry-run", "--yes"])
        const declined = run(item, ["setup"])

        expect(dry.stdout).toContain("planned-providers: acme")
        // The summary names the provider; no stage reports an import.
        expect(declined.stdout).toContain("acme")
        expect(declined.stdout).not.toContain("providers-imported")
        expect(existsSync(join(item.agentDir, "models.json"))).toBe(false)
        expect(existsSync(join(item.agentDir, "auth.json"))).toBe(false)
      })
    })
  })

  describe("#given a custom provider was found", () => {
    describe("#when setup prints the model report", () => {
      test("#then the placeholder custom-endpoint template is not printed", () => {
        const item = fixture()
        opencode(item, { provider: { acme: ACME } })

        const result = run(item, ["setup", "--dry-run"])

        expect(result.status).toBe(0)
        expect(result.stdout).toContain("docs/guide/agent-model-matching.md")
        expect(result.stdout).not.toContain("<custom-baseUrl-provider>")
      })
    })
  })
})
