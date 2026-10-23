import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { DefaultResourceLoader, ModelRegistry, ModelRuntime, SessionManager, SettingsManager, createAgentSession } from "../senpi-test-runtime"
import { composeOmoSenpiExtension } from "./compose"

test("#given a real session with a late unsafe component #when draft prewarm skips #then the recorded result warns once with component attribution", async () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "omo-prewarm-diagnostic-"))
  const agentDir = join(root, "agent")
  mkdirSync(agentDir)
  const overrides = { HOME: root, OMO_CODING_AGENT_DIR: agentDir, SENPI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_DIR: agentDir, OMO_SENPI_DISABLE_POSTHOG: "1" }
  const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]))
  Object.assign(process.env, overrides)
  // Only the prewarm builtin. The goal builtin's session_start takes a goal-file lock (mkdir under this
  // HOME) that a loaded run can finish after the teardown removed the HOME, recreating it (#9766 leak).
  const settingsManager = SettingsManager.inMemory({
    defaultProjectTrust: "always", enabledBuiltinExtensions: ["cache-keepalive"], promptCache: { keepAlive: { enabled: true } },
  })
  const registry = new ModelRegistry(ModelRuntime.createSync({ modelsPath: null }))
  registry.registerProvider("diagnostic-fixture", {
    api: "openai-responses", baseUrl: "https://api.openai.com/v1", apiKey: "fixture-key",
    models: [{
      id: "gpt-5.6", name: "diagnostic-fixture", reasoning: false, input: ["text"],
      compat: { supportsExplicitPromptCacheMode: true },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 4096,
    }],
  })
  const warnings: unknown[] = []
  const extension = composeOmoSenpiExtension([{
    name: "late-engine-fixture",
    register(api) {
      api.on("session_start", () => {
        const event = "before_agent_start"
        api.on(event, () => undefined)
      })
    },
  }], { logger: { info() {}, error() {}, warn: (_message, details) => { warnings.push(details) } } })
  const loader = new DefaultResourceLoader({
    cwd: root, agentDir, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [extension],
  })
  const manager = SessionManager.inMemory(root)
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined
  let unsubscribe: (() => void) | undefined
  const signal = AbortSignal.timeout(10_000)
  const recorded = Promise.withResolvers<void>()
  const onAbort = () => recorded.reject(new Error("prewarm did not append its entry"))
  signal.addEventListener("abort", onAbort, { once: true })
  try {
    await loader.reload()
    expect(loader.getExtensions().errors).toEqual([])
    ;({ session } = await createAgentSession({
      cwd: root, agentDir, settingsManager, modelRegistry: registry,
      model: registry.find("diagnostic-fixture", "gpt-5.6"), thinkingLevel: "off",
      resourceLoader: loader, sessionManager: manager, autoTitleSessions: false, tools: [],
    }))
    await session.bindExtensions({ mode: "print" })
    expect(warnings).toHaveLength(1)
    warnings.length = 0
    unsubscribe = session.subscribe((event) => {
      if (event.type === "entry_appended" && event.entry.type === "custom" && event.entry.customType === "prompt-cache-prewarm") recorded.resolve()
    })
    // when: subscribe before the real activity edge; no timing-based wait.
    session.recordUserActivity("draft")
    await recorded.promise
    await session.extensionRunner?.emit({ type: "agent_start" })
    await session.extensionRunner?.emit({ type: "agent_start" })
    // then
    const entry = manager.getEntries().find((entry) => entry.type === "custom" && entry.customType === "prompt-cache-prewarm")
    const skipped = z.object({ data: z.object({ phase: z.literal("skipped"), reason: z.string() }) }).parse(entry)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      sessionId: manager.getSessionId(), reason: skipped.data.reason,
      handlers: [{ component: "late-engine-fixture", previewSafe: false, source: expect.stringContaining("prewarm-diagnostics-engine.test.ts:") }],
    })
    console.info("OMO_PREWARM_DIAGNOSTIC", JSON.stringify({ phase: skipped.data.phase, warnings: warnings.length }))
  } finally {
    signal.removeEventListener("abort", onAbort)
    unsubscribe?.()
    await session?.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" })
    await session?.dispose()
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    // No builtin left a store under this HOME that could still be written after it is removed.
    const homeEntries = readdirSync(root, { recursive: true }).map(String)
    rmSync(root, { recursive: true, force: true })
    expect(homeEntries.filter((entry) => entry.includes("goal"))).toEqual([])
  }
}, 30_000)
