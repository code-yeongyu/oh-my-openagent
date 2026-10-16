import { expect, test } from "bun:test"
import type { ExtensionContext } from "@code-yeongyu/senpi"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DefaultResourceLoader, ModelRegistry, ModelRuntime, SessionManager, SettingsManager, createAgentSession } from "../senpi-test-runtime"
import omoExtension from "./index"

test("#given a real OmO session #when the engine builds its prewarm prefix #then it is ready rather than skipped by unsafe handlers", async () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "omo-prefix-"))
  const agentDir = join(root, "agent")
  mkdirSync(agentDir)
  mkdirSync(join(root, ".omo"))
  writeFileSync(join(root, ".omo", "omo.json"), JSON.stringify({ memory: { enabled: false } }))
  const cwd = process.cwd()
  const overrides = { HOME: root, OMO_CODING_AGENT_DIR: agentDir, SENPI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_DIR: agentDir, OMO_SENPI_DISABLE_POSTHOG: "1" }
  const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]))
  Object.assign(process.env, overrides)
  process.chdir(root)
  const settingsManager = SettingsManager.inMemory({ defaultProjectTrust: "always" })
  const modelRuntime = ModelRuntime.createSync({ modelsPath: null })
  const registry = new ModelRegistry(modelRuntime)
  registry.registerProvider("prefix-fixture", {
    api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-key",
    models: [{
      id: "prefix-fixture", name: "prefix-fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 100_000, maxTokens: 4096,
    }],
  })
  let context: ExtensionContext | undefined
  const loader = new DefaultResourceLoader({
    cwd: root, agentDir, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [async (pi) => {
      await omoExtension(pi)
      pi.on("session_start", (_event, ctx) => { context = ctx })
    }],
  })
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined
  try {
    await loader.reload()
    expect(loader.getExtensions().errors).toEqual([])
    ;({ session } = await createAgentSession({
      cwd: root, agentDir, settingsManager, modelRegistry: registry,
      model: registry.find("prefix-fixture", "prefix-fixture"), thinkingLevel: "off",
      resourceLoader: loader, sessionManager: SessionManager.inMemory(root),
      autoTitleSessions: false, tools: [],
    }))
    await session.bindExtensions({ mode: "print" })
    if (context?.getPromptCachePrefixRequest === undefined) throw new Error("session_start did not expose the engine prefix builder")
    // when
    const result = await context.getPromptCachePrefixRequest({ signal: AbortSignal.timeout(10_000) })
    // then
    console.info("OMO_PREWARM_PREFIX", JSON.stringify(result.status === "ready" ? { status: result.status } : result))
    expect(result.status).toBe("ready")
    if (result.status === "ready") {
      expect(result.request.context.systemPrompt).toBeTruthy()
      expect(result.request.context.messages).toEqual([])
    }
  } finally {
    await session?.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" })
    await session?.dispose()
    process.chdir(cwd)
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
