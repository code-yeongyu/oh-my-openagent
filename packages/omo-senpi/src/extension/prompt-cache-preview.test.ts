import { afterEach, beforeEach, expect, test } from "bun:test"
import type { ExtensionContext } from "@code-yeongyu/senpi"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DefaultResourceLoader, ModelRegistry, ModelRuntime, SessionManager, SettingsManager, createAgentSession, getMcpService } from "../senpi-test-runtime"
import omoExtension from "./index"

const ENV_KEYS = ["HOME", "OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR", "OMO_SENPI_DISABLE_POSTHOG"] as const
type EnvSnapshot = ReadonlyMap<(typeof ENV_KEYS)[number], string | undefined>
const snapshotEnv = (): EnvSnapshot => new Map(ENV_KEYS.map((key) => [key, process.env[key]]))
function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [key, value] of snapshot) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

// Safety net for a run bun abandons at its own timeout, where the scenario's teardown never runs: the next
// test must still see this process's env, cwd and no leftover temp HOME.
let baseline: { env: EnvSnapshot; cwd: string; roots: string[] } | undefined
beforeEach(() => { baseline = { env: snapshotEnv(), cwd: process.cwd(), roots: [] } })
afterEach(() => {
  if (baseline === undefined) return
  restoreEnv(baseline.env)
  process.chdir(baseline.cwd)
  for (const root of baseline.roots) rmSync(root, { recursive: true, force: true })
  baseline = undefined
})

type Settle = Awaited<ReturnType<ReturnType<typeof getMcpService>["whenAttachSettled"]>>
type Observed = {
  status: string
  systemPrompt: unknown
  messages: unknown
  serversBefore: unknown
  serversAfter: unknown
  connectionsBefore: number
  connectionsAfter: number
  settledAfterPreview: Settle
}
const TEARDOWN_STEP_MS = 15_000

/** Resolves or rejects with `step`, or rejects once `ms` passes so a hung teardown step cannot hold the test. */
async function bounded<T>(step: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms} ms`)), ms)
  })
  try {
    return await Promise.race([step, deadline])
  } finally {
    clearTimeout(timer)
  }
}

type Teardown = { errors: unknown[]; mcpDisposed: boolean | undefined; homeEntries: string[]; homeRemoved: boolean; ownsProcess: boolean }

/**
 * Builds a real OmO session in a temp HOME and asks the engine for its prewarm prefix. Teardown always runs and
 * restores cwd + env and removes the HOME before anything is asserted, so a failure here (an attach that does
 * not settle, a throw in the preview) can never leave this process's env pointing at the removed HOME.
 */
type Session = Awaited<ReturnType<typeof createAgentSession>>["session"]
async function runPrefixScenario(options: {
  attachSettleMs: number
  extraMcpServers?: Record<string, unknown>
  teardownStepMs?: number
  disposeSession?: (session: Session) => Promise<void>
}) {
  // A run bun abandoned at its timeout has already been cleaned up by afterEach and may resume while a later
  // test runs; it must then leave the process alone, so it only restores state it still owns.
  const owner = baseline
  const root = mkdtempSync(join(tmpdir(), "omo-prefix-"))
  owner?.roots.push(root)
  const agentDir = join(root, "agent")
  mkdirSync(agentDir)
  // The bundled remote MCPs (context7, grep_app) would race a network connect at startup in a fresh HOME;
  // a loaded or offline host turns that into an attach that does not settle. The documented switch is a
  // trusted user mcp.json entry with enabled:false.
  writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({
    mcpServers: { context7: { enabled: false }, grep_app: { enabled: false }, ...options.extraMcpServers },
  }))
  mkdirSync(join(root, ".omo"))
  writeFileSync(join(root, ".omo", "omo.json"), JSON.stringify({ memory: { enabled: false } }))
  // Fresh stamps throttle the session-start process sweeps, which would otherwise list this machine's
  // real processes and write their stamps into the temp HOME after the test removed it.
  const sweepStamps = join(root, ".omo", "lsp-daemon")
  mkdirSync(sweepStamps)
  for (const stamp of ["lsp-proxy-sweep.stamp", "lsp-daemon-sweep.stamp"]) writeFileSync(join(sweepStamps, stamp), "")
  const cwd = process.cwd()
  const previous = snapshotEnv()
  Object.assign(process.env, { HOME: root, OMO_CODING_AGENT_DIR: agentDir, SENPI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_DIR: agentDir, OMO_SENPI_DISABLE_POSTHOG: "1" })
  process.chdir(root)
  // The OmO extension is loaded whole; of the engine builtins only those this test needs: the MCP host the
  // extension's servers attach to and the prewarm builtin. The goal builtin's session_start takes a goal-file
  // lock (mkdir under this HOME) that a loaded run can finish after the HOME is removed (#9766 leak).
  const settingsManager = SettingsManager.inMemory({ defaultProjectTrust: "always", enabledBuiltinExtensions: ["cache-keepalive", "mcp"] })
  const registry = new ModelRegistry(ModelRuntime.createSync({ modelsPath: null }))
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
  let session: Session | undefined
  let mcp: ReturnType<typeof getMcpService> | undefined
  let observed: Observed | undefined
  let failure: unknown
  try {
    await loader.reload()
    const loadErrors = loader.getExtensions().errors
    if (loadErrors.length > 0) throw new Error(`extension load errors: ${JSON.stringify(loadErrors)}`)
    ;({ session } = await createAgentSession({
      cwd: root, agentDir, settingsManager, modelRegistry: registry,
      model: registry.find("prefix-fixture", "prefix-fixture"), thinkingLevel: "off",
      resourceLoader: loader, sessionManager: SessionManager.inMemory(root),
      autoTitleSessions: false, tools: [],
    }))
    await session.bindExtensions({ mode: "print" })
    if (context?.getPromptCachePrefixRequest === undefined) throw new Error("session_start did not expose the engine prefix builder")
    // Binding the session, not the preview, starts the MCP connects (ast-grep spawns past session_start and
    // logs into this HOME). Await their settled signal, bounded, before the preview so anything the preview
    // started would show, and so no connect is still writing when the HOME is removed.
    const service = getMcpService()
    mcp = service
    const settled = await service.whenAttachSettled(options.attachSettleMs)
    if (settled !== "settled") throw new Error(`MCP attach did not settle within ${options.attachSettleMs} ms (${String(settled)})`)
    const servers = () => service.getServerSnapshots().map(({ name, lifecycleState, generation, pid }) => ({ name, lifecycleState, generation, pid }))
    const serversBefore = servers()
    const connectionsBefore = service.getSnapshot().connectionCount
    // when
    const result = await context.getPromptCachePrefixRequest({ signal: AbortSignal.timeout(10_000) })
    console.info("OMO_PREWARM_PREFIX", JSON.stringify(result.status === "ready" ? { status: result.status } : result))
    observed = {
      status: result.status,
      systemPrompt: result.status === "ready" ? result.request.context.systemPrompt : undefined,
      messages: result.status === "ready" ? result.request.context.messages : undefined,
      serversBefore, serversAfter: servers(), connectionsBefore,
      connectionsAfter: service.getSnapshot().connectionCount,
      // Anything the preview started would still be pending here; await that signal, bounded.
      settledAfterPreview: await service.whenAttachSettled(10_000),
    }
  } catch (caught) {
    failure = caught
  }
  // Teardown: bounded shutdown + dispose (errors collected, never thrown), then - in its own finally, so a hung or
  // throwing step cannot skip it - restore cwd + env and remove the HOME. Every assertion happens after this point.
  const errors: unknown[] = []
  const stepMs = options.teardownStepMs ?? TEARDOWN_STEP_MS
  const disposeSession = options.disposeSession ?? (async (live: Session): Promise<void> => { await live.dispose() })
  let mcpDisposed: boolean | undefined
  let homeEntries: string[] = []
  const ownsProcess = (): boolean => owner !== undefined && baseline === owner
  try {
    // dispose does not wait for a connect still in flight; when that connect later fails it logs into this HOME
    // (logs/mcp/<server>.log), after the HOME is gone. Let every attach connect finish first, bounded.
    try {
      const settled = await mcp?.whenAttachSettled(stepMs)
      if (settled !== undefined && settled !== "settled") errors.push(new Error(`MCP attach still pending at teardown (${String(settled)})`))
    } catch (caught) { errors.push(caught) }
    try {
      await bounded(Promise.resolve(session?.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" })), stepMs, "session_shutdown")
    } catch (caught) { errors.push(caught) }
    try {
      if (session !== undefined) await bounded(disposeSession(session), stepMs, "session.dispose()")
    } catch (caught) { errors.push(caught) }
    mcpDisposed = mcp?.getSnapshot().disposed
  } finally {
    if (ownsProcess()) {
      process.chdir(cwd)
      restoreEnv(previous)
      try { homeEntries = readdirSync(root, { recursive: true }).map(String) } catch (caught) { errors.push(caught) }
      rmSync(root, { recursive: true, force: true })
    }
  }
  const teardown: Teardown = { errors, mcpDisposed, homeEntries, homeRemoved: !existsSync(root), ownsProcess: ownsProcess() }
  return { observed, failure, teardown, envAfter: snapshotEnv(), cwdAfter: process.cwd(), envBefore: previous, cwdBefore: cwd }
}

test("#given a real OmO session #when the engine builds its prewarm prefix #then it is ready rather than skipped by unsafe handlers", async () => {
  // given / when
  const run = await runPrefixScenario({ attachSettleMs: 30_000 })
  // then: teardown already restored the process, so these assertions cannot leak state into later tests
  if (run.failure !== undefined) throw run.failure
  expect(run.teardown.errors).toEqual([])
  expect(run.observed?.status).toBe("ready")
  expect(run.observed?.systemPrompt).toBeTruthy()
  expect(run.observed?.messages).toEqual([])
  expect(run.observed?.serversAfter).toEqual(run.observed?.serversBefore)
  expect(run.observed?.connectionsAfter).toBe(run.observed?.connectionsBefore ?? -1)
  expect(run.observed?.settledAfterPreview).toBe("settled")
  // The quit disposes the MCP service and awaits every connection's close, so nothing it started writes later.
  expect(run.teardown.mcpDisposed).toBe(true)
  expect(run.teardown.homeEntries.filter((entry) => /(^|[\\/])goals?([\\/.-]|$)/.test(entry))).toEqual([])
  expect(run.teardown.homeRemoved).toBe(true)
}, 90_000)

test("#given an MCP attach that never settles #when the prefix scenario fails #then the process env, cwd and temp HOME are restored before it reports", async () => {
  // given: an eager stdio server that is spawned but never answers initialize, so the attach cannot settle
  // within the 1 s bound (its connect times out at 3 s, before teardown disposes the session)
  const neverReady = { command: process.execPath, args: ["-e", "setInterval(() => {}, 1 << 30)"], lifecycle: "eager", connectTimeoutMs: 3_000 }
  // when
  const run = await runPrefixScenario({ attachSettleMs: 1_000, extraMcpServers: { "never-ready": neverReady } })
  // then
  expect(String(run.failure)).toContain("MCP attach did not settle within 1000 ms")
  expect(run.envAfter).toEqual(run.envBefore)
  expect(run.cwdAfter).toBe(run.cwdBefore)
  expect(run.teardown.errors).toEqual([])
  expect(run.teardown.mcpDisposed).toBe(true)
  expect(run.teardown.homeRemoved).toBe(true)
}, 90_000)

test("#given a session dispose that never settles #when the scenario tears down #then the bound reports it and env, cwd and the HOME are still restored", async () => {
  // given: dispose does its real work, then never settles
  const hangingDispose = async (live: Session): Promise<void> => {
    await live.dispose()
    await new Promise<void>(() => {})
  }
  // when
  const run = await runPrefixScenario({ attachSettleMs: 30_000, teardownStepMs: 1_000, disposeSession: hangingDispose })
  // then
  expect(run.failure).toBeUndefined()
  expect(run.teardown.errors.map(String)).toEqual(["Error: session.dispose() did not settle within 1000 ms"])
  expect(run.envAfter).toEqual(run.envBefore)
  expect(run.cwdAfter).toBe(run.cwdBefore)
  expect(run.teardown.homeRemoved).toBe(true)
}, 90_000)
