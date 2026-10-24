import { afterEach, describe, expect, setSystemTime, test as bunTest } from "bun:test"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs"
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
const REPO_NODE_MODULES = resolve(SOURCE_ROOT, "..", "..", "node_modules")
const roots: string[] = []

// Every setup child is awaited on its own exit event under SETUP_CHILD_BOUND_MS, a circuit breaker for a hung child, never
// the expected duration (#10210: the cold registry install that made it slow is gone, see run()). A breach kills that exact
// child and awaits its exit before failing by name; each test's outer breaker sits above its bounded runs. A child still
// alive when a test ends any other way is killed and awaited before teardown, so it never writes into a removed root.
const SETUP_CHILD_BOUND_MS = 60_000
const TEST_BREAKER_MS = 2 * SETUP_CHILD_BOUND_MS + 30_000
type TestBody = () => Promise<void> | void
const test = Object.assign((name: string, body: TestBody) => bunTest(name, body, TEST_BREAKER_MS), {
  skipIf: (condition: boolean) => (name: string, body: TestBody) => bunTest.skipIf(condition)(name, body, TEST_BREAKER_MS),
})
const liveChildren = new Map<ChildProcess, Promise<void>>()

afterEach(async () => {
  const running = [...liveChildren]
  for (const [child] of running) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  await Promise.all(running.map(([, closed]) => closed))
  teardownRoots(roots)
})

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

type Fixture = { home: string, agentDir: string, configHome: string, dataHome: string, tmp: string, launcher: string }

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-providers-e2e-"))
  roots.push(root)
  const app = join(root, "app")
  mkdirSync(join(root, "home"), { recursive: true })
  mkdirSync(join(root, "tmp"), { recursive: true })
  cpSync(join(SOURCE_ROOT, "bin"), join(app, "bin"), { recursive: true })
  // The installed omo-ai resolves its pinned engine from its own node_modules; the copied app gets the
  // workspace's, so reading the engine's model list stays offline (a junction needs no privilege on Windows).
  symlinkSync(REPO_NODE_MODULES, join(app, "node_modules"), "junction")
  write(join(app, "package.json"), JSON.stringify({ name: "omo-ai", version: "test", type: "module" }))
  return {
    home: join(root, "home"),
    agentDir: join(root, "senpi-agent"),
    configHome: join(root, "config"),
    dataHome: join(root, "data"),
    tmp: join(root, "tmp"),
    launcher: join(app, "bin", "omo.js"),
  }
}

function opencode(item: Fixture, config: unknown, auth?: unknown): void {
  write(join(item.configHome, "opencode", "opencode.json"), JSON.stringify(config, null, 2))
  if (auth !== undefined) write(join(item.dataHome, "opencode", "auth.json"), JSON.stringify(auth))
}

// The child gets its own temp dir inside the fixture root, which teardown removes (#9766). Bun's runtime
// transpiler cache is off: by default it lands in `$HOME/.bun/install/cache/@t@` on Linux and Windows, so
// the child would write into the fixture home whether or not it installed anything.
function childEnv(item: Fixture): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    TMPDIR: item.tmp,
    TEMP: item.tmp,
    TMP: item.tmp,
    BUN_TMPDIR: item.tmp,
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
  delete env.XDG_CACHE_HOME
  delete env.OPENCODE_MODELS_PATH
  return env
}

type RunResult = { status: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }

async function run(item: Fixture, args: string[]): Promise<RunResult> {
  // --no-install: a module the copied app cannot resolve fails the run instead of Bun fetching it from the
  // registry into the fixture home, a cold network install on every run that timed out on Windows (#10210).
  const child = spawn(process.execPath, ["--no-install", item.launcher, ...args], { env: childEnv(item), stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => { stdout += chunk })
  child.stderr.on("data", (chunk: string) => { stderr += chunk })
  child.stdout.on("error", (error) => { stderr += `\n[stdout stream error] ${String(error)}` })
  child.stderr.on("error", (error) => { stderr += `\n[stderr stream error] ${String(error)}` })
  const closed = new Promise<RunResult>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }))
  })
  liveChildren.set(child, closed.then(() => undefined, () => undefined))
  let timer: ReturnType<typeof setTimeout> | undefined
  const breach = new Promise<"breach">((resolve) => { timer = setTimeout(() => resolve("breach"), SETUP_CHILD_BOUND_MS) })
  try {
    const first = await Promise.race([closed, breach])
    if (first !== "breach") return first
    child.kill("SIGKILL")
    const killed = await closed
    throw new Error(`omo ${args.join(" ")} did not exit within ${SETUP_CHILD_BOUND_MS} ms; killed (signal ${String(killed.signal)})\nstdout: ${stdout.slice(-2000)}\nstderr: ${stderr.slice(-2000)}`)
  } finally {
    clearTimeout(timer)
    liveChildren.delete(child)
  }
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
      test("#then the pinned engine's own loader composes them with the api, baseUrl and limits opencode declared", async () => {
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

        const result = await run(item, ["setup", "--yes"])
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
      test("#then the engine sends each model to the endpoint opencode would", async () => {
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

        const result = await run(item, ["setup", "--yes"])
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

        const result = await run(item, ["setup", "--yes"])
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
      test("#then an unsupported npm package, a built-in provider override and a url only opencode can expand are reported by name and not written", async () => {
        const item = fixture()
        opencode(item, {
          provider: {
            acme: ACME,
            gemini: { npm: "@ai-sdk/google", options: { baseURL: "https://g.example/v1beta" }, models: { g: {} } },
            openai: { options: { baseURL: "https://proxy.example/v1" }, models: { "gpt-x": {} } },
            hosted: { options: { baseURL: "https://${ACME_HOST}/v1" }, models: { h: {} } },
          },
        })

        const result = await run(item, ["setup", "--yes"])

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
      test("#then existing entries stay byte-identical, the rest is added once with a backup, and the second run writes nothing", async () => {
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

        const first = await run(item, ["setup", "--yes"])
        const models = readJson(join(item.agentDir, "models.json"))
        const backups = readdirSync(item.agentDir).filter((name) => name.includes(".bak-"))
        const bytes = ["models.json", "auth.json"].map((name) => readFileSync(join(item.agentDir, name), "utf8"))
        const second = await run(item, ["setup", "--yes"])

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
      test.skipIf(process.platform === "win32")("#then the provider lands in the linked file and the link stays a link", async () => {
        const item = fixture()
        const linked = join(dirname(item.agentDir), "dotfiles", "models.json")
        write(linked, JSON.stringify({ providers: {} }))
        mkdirSync(item.agentDir, { recursive: true })
        symlinkSync(linked, join(item.agentDir, "models.json"))
        opencode(item, { provider: { acme: ACME } })

        const result = await run(item, ["setup", "--yes"])

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
      test("#then the key the credential stage wrote in the same run is kept, not overwritten", async () => {
        // claude-sdk-oauth maps to anthropic-subscription, which is not a builtin id to the provider stage.
        const item = fixture()
        const provider = { npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://x.example/v1", apiKey: "provider-key" }, models: { m: {} } }
        opencode(item, { provider: { "anthropic-subscription": provider } }, { "claude-sdk-oauth": { type: "api", key: "credential-key" } })

        const result = await run(item, ["setup", "--yes"])

        expect(result.status).toBe(0)
        expect(readJson(join(item.agentDir, "auth.json"))).toEqual({ "anthropic-subscription": { type: "api_key", key: "credential-key" } })
        expect(result.stdout).toContain("provider-keys-imported: 0")
      })
    })
  })

  describe("#given a custom provider and no consent", () => {
    describe("#when setup is a dry run or runs non-interactively without --yes", () => {
      test("#then the provider is previewed and nothing is written", async () => {
        const item = fixture()
        opencode(item, { provider: { acme: ACME } })

        // --yes alongside --dry-run: only the dry-run guard stands between the preview and a write.
        const dry = await run(item, ["setup", "--dry-run", "--yes"])
        const declined = await run(item, ["setup"])

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
      test("#then the placeholder custom-endpoint template is not printed", async () => {
        const item = fixture()
        opencode(item, { provider: { acme: ACME } })

        const result = await run(item, ["setup", "--dry-run"])

        expect(result.status).toBe(0)
        expect(result.stdout).toContain("docs/guide/agent-model-matching.md")
        expect(result.stdout).not.toContain("<custom-baseUrl-provider>")
      })
    })
  })
})

const NEURALWATT_CATALOG = {
  neuralwatt: {
    id: "neuralwatt",
    env: ["NEURALWATT_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.neuralwatt.com/v1",
    name: "Neuralwatt",
    models: {
      "kimi-k2.5": { id: "kimi-k2.5", name: "Kimi K2.5", reasoning: true, limit: { context: 262144, output: 32768 } },
      "old-model": { id: "old-model", status: "deprecated", limit: { context: 8192, output: 1024 } },
    },
  },
}

describe("omo setup opencode catalog provider import (#10158)", () => {
  describe("#given an opencode api key for a models.dev provider omo has no builtin for", () => {
    describe("#when setup is accepted", () => {
      test("#then the provider is described from opencode's catalog cache, its key stored and the default model carried", async () => {
        const item = fixture()
        opencode(item, { model: "neuralwatt/kimi-k2.5" }, { neuralwatt: { type: "api", key: "nw-key" } })
        write(join(item.home, ".cache", "opencode", "models.json"), JSON.stringify(NEURALWATT_CATALOG))

        const result = await run(item, ["setup", "--yes"])
        const config = ModelConfig.loadSync(join(item.agentDir, "models.json"))
        const models = composeModelProvider("neuralwatt", undefined, config, undefined).getModels()

        expect(result.status).toBe(0)
        expect(config.getError()).toBeUndefined()
        expect(models.map((model: any) => [model.id, model.api, model.baseUrl, model.contextWindow, model.maxTokens, model.reasoning])).toEqual([
          ["kimi-k2.5", "openai-completions", "https://api.neuralwatt.com/v1", 262144, 32768, true],
        ])
        expect(readAuthStore(join(item.agentDir, "auth.json")).entries.neuralwatt).toMatchObject({ type: "api_key" })
        expect(result.stdout).toContain("providers-imported: neuralwatt")
        expect(result.stdout).not.toContain("could not read the engine's model list")
        expect(result.stdout).toContain("model-choices-carried: default model")
        expect(readJson(join(item.agentDir, "settings.json"))).toMatchObject({ defaultProvider: "neuralwatt", defaultModel: "kimi-k2.5" })
        expect(result.stdout).not.toContain("providers omo does not serve (neuralwatt)")
        expect(result.stdout).not.toContain("provider neuralwatt is not one omo serves")
      })
    })
  })

  describe("#given that key but no catalog cache", () => {
    describe("#when setup runs", () => {
      test("#then it says how to get the catalog instead of importing a guess", async () => {
        const item = fixture()
        opencode(item, {}, { neuralwatt: { type: "api", key: "nw-key" } })

        const result = await run(item, ["setup", "--yes"])

        expect(result.status).toBe(0)
        expect(result.stdout).toContain("no models.dev catalog cache found, so neuralwatt could not be described")
        expect(existsSync(join(item.agentDir, "models.json"))).toBe(false)
      })
    })
  })

  describe("#given a partial opencode config block for a catalog provider", () => {
    describe("#when setup is accepted", () => {
      test("#then the block extends the catalog entry as opencode does, instead of replacing it", async () => {
        const item = fixture()
        opencode(item, { provider: { neuralwatt: { options: { apiKey: "nw-inline" }, models: { "kimi-k2.5": { limit: { context: 131072, output: 16384 } } } } } })
        write(join(item.home, ".cache", "opencode", "models.json"), JSON.stringify(NEURALWATT_CATALOG))

        const result = await run(item, ["setup", "--yes"])
        const config = ModelConfig.loadSync(join(item.agentDir, "models.json"))
        const models = composeModelProvider("neuralwatt", undefined, config, undefined).getModels()

        expect(result.status).toBe(0)
        expect(models.map((model: any) => [model.id, model.baseUrl, model.contextWindow, model.reasoning])).toEqual([
          ["kimi-k2.5", "https://api.neuralwatt.com/v1", 131072, true],
        ])
      })
    })
  })

  describe("#given a config block that overrides only part of a catalog model's limit", () => {
    describe("#when setup is accepted", () => {
      test("#then the other limit and the model's own fields come from the catalog, as opencode merges them", async () => {
        const item = fixture()
        opencode(item, { provider: { neuralwatt: { options: { apiKey: "nw-inline" }, models: { "kimi-k2.5": { limit: { context: 131072 } } } } } })
        write(join(item.home, ".cache", "opencode", "models.json"), JSON.stringify(NEURALWATT_CATALOG))

        await run(item, ["setup", "--yes"])
        const config = ModelConfig.loadSync(join(item.agentDir, "models.json"))
        const models = composeModelProvider("neuralwatt", undefined, config, undefined).getModels()

        expect(models.map((model: any) => [model.id, model.contextWindow, model.maxTokens, model.reasoning])).toEqual([
          ["kimi-k2.5", 131072, 32768, true],
        ])
      })
    })
  })

  describe("#given a catalog provider declared with no key of its own", () => {
    describe("#when setup is accepted", () => {
      test("#then its key resolves from the catalog's environment variable, as opencode reads it", async () => {
        const item = fixture()
        opencode(item, { provider: { neuralwatt: {} } })
        write(join(item.home, ".cache", "opencode", "models.json"), JSON.stringify(NEURALWATT_CATALOG))

        await run(item, ["setup", "--yes"])

        expect(readAuthStore(join(item.agentDir, "auth.json")).entries.neuralwatt).toMatchObject({ key: "${NEURALWATT_API_KEY}" })
      })
    })
  })

  describe("#given a keyed catalog provider omo has no adapter for", () => {
    describe("#when setup runs", () => {
      test("#then it is reported once, with the adapter reason, not also as a provider omo does not serve", async () => {
        const item = fixture()
        opencode(item, {}, { exotic: { type: "api", key: "ex-key" } })
        write(join(item.home, ".cache", "opencode", "models.json"), JSON.stringify({
          exotic: { id: "exotic", npm: "@ai-sdk/exotic", api: "https://exotic.example/v1", name: "Exotic", models: { m: { id: "m" } } },
        }))

        const result = await run(item, ["setup", "--yes"])

        expect(result.stdout).toContain("catalog provider exotic uses npm package @ai-sdk/exotic")
        expect(result.stdout).not.toContain("providers omo does not serve (exotic)")
      })
    })
  })

  describe("#given a catalog provider routed through its own proxy endpoint, with no model list and no stored key", () => {
    describe("#when setup is accepted", () => {
      test("#then the proxy endpoint is used with the catalog's models, as opencode extends them", async () => {
        const item = fixture()
        opencode(item, { provider: { neuralwatt: { options: { apiKey: "nw-inline", baseURL: "https://proxy.example/v1" } } } })
        write(join(item.home, ".cache", "opencode", "models.json"), JSON.stringify(NEURALWATT_CATALOG))

        const result = await run(item, ["setup", "--yes"])
        const config = ModelConfig.loadSync(join(item.agentDir, "models.json"))
        const models = composeModelProvider("neuralwatt", undefined, config, undefined).getModels()

        expect(result.stdout).toContain("providers-imported: neuralwatt")
        expect(models.map((model: any) => [model.id, model.baseUrl, model.contextWindow, model.reasoning])).toEqual([
          ["kimi-k2.5", "https://proxy.example/v1", 262144, true],
        ])
      })
    })
  })
})

describe("omo setup opencode catalog notices (#10172)", () => {
  describe("#given a provider block with its own endpoint but no models, and a catalog cache that cannot be parsed", () => {
    describe("#when setup is accepted", () => {
      test("#then the broken-cache warning is shown, because the block still takes its models from the catalog", async () => {
        const item = fixture()
        opencode(item, { provider: { proxied: { options: { baseURL: "https://proxy.example/v1", apiKey: "proxy-key" } } } })
        write(join(item.home, ".cache", "opencode", "models.json"), "{ not json")

        const result = await run(item, ["setup", "--yes"])

        expect(result.status).toBe(0)
        expect(result.stdout).toContain("could not parse its models.dev catalog cache")
        expect(result.stdout).toContain("custom provider proxied declares no models omo can use")
      })
    })
  })

  describe("#given a provider block with its own endpoint and its own models, and a catalog cache that cannot be parsed", () => {
    describe("#when setup is accepted", () => {
      test("#then no broken-cache warning is shown and the provider is imported from its own block", async () => {
        const item = fixture()
        opencode(item, { provider: { selfcontained: { options: { baseURL: "https://self.example/v1", apiKey: "self-key" }, models: { m: {} } } } })
        write(join(item.home, ".cache", "opencode", "models.json"), "{ not json")

        const result = await run(item, ["setup", "--yes"])

        expect(result.status).toBe(0)
        expect(result.stdout).not.toContain("could not parse its models.dev catalog cache")
        expect(result.stdout).toContain("providers-imported: selfcontained")
      })
    })
  })

  describe("#given an opencode api key for an id the catalog was read for but has no entry for, and no config block for it", () => {
    describe("#when setup runs", () => {
      test("#then the provider stage says the id is not in the catalog, instead of the credential stage's generic unmapped line", async () => {
        const item = fixture()
        opencode(item, {}, { ghost: { type: "api", key: "ghost-key" } })
        write(join(item.home, ".cache", "opencode", "models.json"), JSON.stringify(NEURALWATT_CATALOG))

        const result = await run(item, ["setup", "--yes"])

        expect(result.status).toBe(0)
        expect(result.stdout).toContain("provider ghost is not in OpenCode's models.dev catalog")
        expect(result.stdout).not.toContain("providers omo does not serve (ghost)")
        expect(planOpencodeProviders({ home: item.home, env: { XDG_CONFIG_HOME: item.configHome, XDG_DATA_HOME: item.dataHome } }).skipped).toEqual(["ghost"])
      })
    })
  })
})

describe("omo setup e2e temp isolation (#9766)", () => {
  test("#given a setup run #when the child process asks for its temp dir #then it is inside the fixture root that teardown removes", () => {
    const item = fixture()

    const child = spawnSync(process.execPath, ["-e", "console.log(require('node:os').tmpdir())"], { encoding: "utf8", env: childEnv(item) })

    expect(child.status).toBe(0)
    expect(realpathSync(child.stdout.trim())).toBe(realpathSync(item.tmp))
  })

  test("#given a setup run that reads the engine's model list #when it finishes #then the child installed nothing and left nothing in its home or temp dir (#10210)", async () => {
    const item = fixture()
    opencode(item, { model: "neuralwatt/kimi-k2.5" }, { neuralwatt: { type: "api", key: "nw-key" } })
    write(join(item.home, ".cache", "opencode", "models.json"), JSON.stringify(NEURALWATT_CATALOG))

    const result = await run(item, ["setup", "--yes"])

    expect(result.status).toBe(0)
    expect(existsSync(join(item.home, ".bun"))).toBe(false)
    expect(readdirSync(item.tmp)).toEqual([])
  })
})

