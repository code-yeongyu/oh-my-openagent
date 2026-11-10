import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadSenpiBarrel } from "../lazy/senpi-barrel"
import { assistant, streamMessage } from "./__fixtures__/in-process-fallback-session"
import type { ChildDialogForwarder } from "./child-dialogs/forwarder"
import { InProcessRunner } from "./in-process"

// #12965: the omo launcher boots the parent from senpi's bundle (`dist/bundle/cli.js`) while an in-process task
// child runs on the SDK barrel (`dist/index.js`), a second engine graph. senpi remembers every value a config
// reference resolves to in a module-local set (`core/config-reference-redaction.ts`) and redacts those values from
// text before it reaches a sink. A value the parent resolved must still be redacted when the child writes it.
//
// The parent resolves a provider API key `{ "$env": ... }` from its models.json, as it does before its own
// requests. The child's provider then answers with a model configuration error whose body echoes that value, and
// the child logs it to `logs/fallback.log` through the engine's redaction. Each case uses its own synthetic marker.

type SenpiModule = typeof import("@code-yeongyu/senpi")

const PARENT_PROVIDER = "redaction-12965-parent"
const CHILD_PROVIDER = "redaction-12965-child"
const CHILD_MODEL = "echo"

const roots: string[] = []
const disposers: (() => void)[] = []
const envNames: string[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  for (const name of envNames.splice(0)) delete process.env[name]
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function loadBundledSenpi(): Promise<SenpiModule> {
  const sdkEntry = import.meta.resolve("@code-yeongyu/senpi")
  return (await import(new URL("./bundle/index.js", sdkEntry).href)) as SenpiModule
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "senpi-task-12965-redact-"))
  roots.push(root)
  return root
}

async function parentResolvesSecret(senpi: SenpiModule, envName: string, secret: string): Promise<void> {
  process.env[envName] = secret
  envNames.push(envName)
  const agentDir = join(tempRoot(), "agent")
  mkdirSync(agentDir, { recursive: true })
  const modelsPath = join(agentDir, "models.json")
  writeFileSync(modelsPath, JSON.stringify({
    providers: {
      [PARENT_PROVIDER]: {
        baseUrl: "http://127.0.0.1:9/v1",
        api: "openai-completions",
        apiKey: { $env: envName },
        models: [{ id: "parent", name: "parent", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 4096 }],
      },
    },
  }))
  const modelRuntime = senpi.ModelRuntime.createSync({ agentDir, modelsPath, allowModelNetwork: false, refreshOnCreate: false })
  const modelRegistry = new senpi.ModelRegistry(modelRuntime)
  expect(await modelRegistry.getApiKeyForProvider(PARENT_PROVIDER)).toBe(secret)
}

async function runChildEchoing(secret: string): Promise<string> {
  const senpi = await loadSenpiBarrel()
  const root = tempRoot()
  const agentDir = join(root, "agent")
  const cwd = join(root, "work")
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  const modelRuntime = senpi.ModelRuntime.createSync({ agentDir, allowModelNetwork: false, refreshOnCreate: false })
  const modelRegistry = new senpi.ModelRegistry(modelRuntime)
  const errorMessage = `The model \`${CHILD_MODEL}\` does not exist (gateway echo: ${secret})`
  const provider = {
    api: "openai-completions",
    baseUrl: "file://redaction-12965-child",
    apiKey: "test-key",
    models: [{ id: CHILD_MODEL, name: CHILD_MODEL, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 4096 }],
    streamSimple() {
      return streamMessage({
        ...assistant(CHILD_MODEL, "error", "", errorMessage, CHILD_PROVIDER),
        errorCause: { type: "model_config", model: `${CHILD_PROVIDER}/${CHILD_MODEL}` },
      } as ReturnType<typeof assistant>)
    },
  }
  Reflect.apply(modelRegistry.registerProvider, modelRegistry, [CHILD_PROVIDER, provider])
  const model = modelRegistry.find(CHILD_PROVIDER, CHILD_MODEL)
  if (model === undefined) throw new Error("the child model is missing from the fake provider")
  const forwarder: ChildDialogForwarder = { forward: async () => ({ kind: "value", value: "Deny" }) }
  const handle = await new InProcessRunner({ dialogs: forwarder }).start({
    taskId: "st_12965_redact",
    cwd,
    sessionDir: join(root, "children", "st_12965_redact"),
    agentDir,
    projectTrusted: false,
    modelRuntime,
    modelRegistry,
    model,
    selectedModel: `${CHILD_PROVIDER}/${CHILD_MODEL}`,
    retry: { maxRetries: 0 },
    depth: 1,
    parentSessionId: "parent-12965",
    rootSessionId: "parent-12965",
    prompt: "answer",
    promptEnvelope: "bare",
    completion: "turn",
  })
  await handle.waitForIdle()
  await handle.abort()
  const log = join(agentDir, "logs", "fallback.log")
  if (!existsSync(log)) throw new Error("the child wrote no fallback.log")
  return readFileSync(log, "utf8")
}

describe("in-process child redaction under a parent from another engine graph", () => {
  test("#given a parent on the bundled engine that resolved a secret #when its in-process child logs that value #then the log carries it redacted", async () => {
    // given
    const secret = "synthetic-12965-bundle-marker-qv7k"
    await parentResolvesSecret(await loadBundledSenpi(), "SENPI_TASK_12965_SYNTHETIC_BUNDLE", secret)

    // when
    const log = await runChildEchoing(secret)

    // then
    expect(log).toContain("model_config_error")
    expect(log).not.toContain(secret)
  }, 30_000)

  test("#given a parent on the SDK engine that resolved a secret #when its in-process child logs that value #then the log carries it redacted", async () => {
    // given
    const secret = "synthetic-12965-sdk-marker-zp4m"
    await parentResolvesSecret(await loadSenpiBarrel(), "SENPI_TASK_12965_SYNTHETIC_SDK", secret)

    // when
    const log = await runChildEchoing(secret)

    // then
    expect(log).toContain("model_config_error")
    expect(log).not.toContain(secret)
  }, 30_000)
})
