import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import {
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "../senpi-test-runtime"
import { composeOmoSenpiExtension } from "./compose"
import { testBudgetSignal, useTestTimeout } from "../../../../test-support/test-deadline"

const SETTLED_LOG = ["agent/logs", "agent/logs/.fallback-log-v2"]
// What the engine itself may write under the HOME while the session is created and its extensions bind: the
// seeded agent layout, the bundled extensions it stages, and its fallback log. Anything else written before
// the baseline (a builtin's store taken at session_start) fails the bind-delta allowlist (#10933 review LOW).
const ENGINE_ARTIFACTS = [
  "agent/auth.json",
  "agent/extensions",
  "agent/extensions/diff.js",
  "agent/extensions/files.js",
  "agent/extensions/prompt-url-widget.js",
  "agent/extensions/tps.js",
  ...SETTLED_LOG,
]

/** Every path under the HOME, backslash-normalized so windows-latest listings match. */
function homeListing(root: string): string[] {
  return readdirSync(root, { recursive: true })
    .map((entry) => String(entry).replaceAll("\\", "/"))
    .sort()
}

test("#given a real session with a late unsafe component #when draft prewarm skips #then the recorded result warns once with component attribution", async () => {
  useTestTimeout(30_000)
  // given
  const root = mkdtempSync(join(tmpdir(), "omo-prewarm-diagnostic-"))
  const agentDir = join(root, "agent")
  mkdirSync(agentDir)
  const beforeBind = homeListing(root)
  const overrides = {
    HOME: root,
    OMO_CODING_AGENT_DIR: agentDir,
    SENPI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_DIR: agentDir,
    OMO_SENPI_DISABLE_POSTHOG: "1",
  }
  const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]))
  Object.assign(process.env, overrides)
  // Only the prewarm builtin. The goal builtin's session_start takes a goal-file lock (mkdir under this
  // HOME) that a loaded run can finish after the teardown removed the HOME, recreating it (#9766 leak).
  const settingsManager = SettingsManager.inMemory({
    defaultProjectTrust: "always",
    enabledBuiltinExtensions: ["cache-keepalive"],
    promptCache: { keepAlive: { enabled: true } },
  })
  const registry = new ModelRegistry(ModelRuntime.createSync({ modelsPath: null }))
  registry.registerProvider("diagnostic-fixture", {
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "fixture-key",
    models: [
      {
        id: "gpt-5.6",
        name: "diagnostic-fixture",
        reasoning: false,
        input: ["text"],
        compat: { supportsExplicitPromptCacheMode: true },
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100_000,
        maxTokens: 4096,
      },
    ],
  })
  const warnings: unknown[] = []
  const extension = composeOmoSenpiExtension(
    [
      {
        name: "late-engine-fixture",
        register(api) {
          api.on("session_start", () => {
            const event = "before_agent_start"
            api.on(event, () => undefined)
          })
        },
      },
    ],
    {
      logger: {
        info() {},
        error() {},
        warn: (_message, details) => {
          warnings.push(details)
        },
      },
    },
  )
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [extension],
  })
  const manager = SessionManager.inMemory(root)
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined
  let unsubscribe: (() => void) | undefined
  // The HOME as the initialized fixture leaves it, before the activity under test. The engine may stage its
  // bundled extensions under agent/ while the session starts; only what appears after this point is checked.
  let baseline: readonly string[] = []
  const signal = testBudgetSignal("the prewarm diagnostics entry")
  const recorded = Promise.withResolvers<void>()
  const onAbort = () => recorded.reject(new Error("prewarm did not append its entry"))
  signal.addEventListener("abort", onAbort, { once: true })
  try {
    await loader.reload()
    expect(loader.getExtensions().errors).toEqual([])
    ;({ session } = await createAgentSession({
      cwd: root,
      agentDir,
      settingsManager,
      modelRegistry: registry,
      model: registry.find("diagnostic-fixture", "gpt-5.6"),
      thinkingLevel: "off",
      resourceLoader: loader,
      sessionManager: manager,
      autoTitleSessions: false,
      tools: [],
    }))
    await session.bindExtensions({ mode: "print" })
    baseline = homeListing(root)
    expect(baseline.filter((entry) => !beforeBind.includes(entry) && !ENGINE_ARTIFACTS.includes(entry))).toEqual([])
    expect(warnings).toHaveLength(1)
    warnings.length = 0
    unsubscribe = session.subscribe((event) => {
      if (
        event.type === "entry_appended" &&
        event.entry.type === "custom" &&
        event.entry.customType === "prompt-cache-prewarm"
      )
        recorded.resolve()
    })
    // when: subscribe before the real activity edge; no timing-based wait.
    session.recordUserActivity("draft")
    await recorded.promise
    await session.extensionRunner?.emit({ type: "agent_start" })
    await session.extensionRunner?.emit({ type: "agent_start" })
    // then
    const entry = manager
      .getEntries()
      .find((entry) => entry.type === "custom" && entry.customType === "prompt-cache-prewarm")
    const skipped = z.object({ data: z.object({ phase: z.literal("skipped"), reason: z.string() }) }).parse(entry)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      sessionId: manager.getSessionId(),
      reason: skipped.data.reason,
      handlers: [
        {
          component: "late-engine-fixture",
          previewSafe: false,
          source: expect.stringContaining("prewarm-diagnostics-engine.test.ts:"),
        },
      ],
    })
    console.info("OMO_PREWARM_DIAGNOSTIC", JSON.stringify({ phase: skipped.data.phase, warnings: warnings.length }))
  } finally {
    signal.removeEventListener("abort", onAbort)
    unsubscribe?.()
    await session?.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" })
    await session?.dispose()
    // senpi's fallback logger finishes its first-start removal asynchronously; removing the agent dir before it settles leaks it (#9766).
    await session?.whenToolChildClosed()
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    // No builtin left a store under this HOME: past the initialized fixture, only the settled fallback log may
    // appear, so a store any builtin writes during the activity or teardown fails this allowlist (#10933).
    const homeEntries = homeListing(root)
    rmSync(root, { recursive: true, force: true })
    expect(homeEntries.filter((entry) => entry.includes("goal"))).toEqual([])
    // A run that failed before the fixture finished initializing has no baseline; its own failure stands.
    if (baseline.length > 0)
      expect(homeEntries.filter((entry) => !baseline.includes(entry) && !SETTLED_LOG.includes(entry))).toEqual([])
  }
}, 30_000)
