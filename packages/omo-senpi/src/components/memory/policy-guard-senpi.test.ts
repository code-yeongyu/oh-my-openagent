import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "../../senpi-test-runtime"
import { composeOmoSenpiExtension } from "../../extension/compose"
import { createMemoryComponent, memoryModuleSupervisor } from "./index"
import { loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

// #15251, review of #15257: the policy registered by the memory component must reach senpi's own file tools,
// through the engine's real runtime bootstrap, not a capturing fake. Synthetic identity only ("late-id").
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0))
    rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function boundSession() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-memory-policy-senpi-")))
  roots.push(root)
  const memoryHome = join(root, "memory")
  const cwd = join(root, "project")
  const agentDir = join(root, "agent")
  mkdirSync(cwd, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  const env = { OMO_MEMORY_HOME: memoryHome }
  const foreignRepo = join(memoryHome, "agents", "late-id", "repo")
  mkdirSync(join(foreignRepo, "system"), { recursive: true })
  writeFileSync(join(foreignRepo, "system", "persona.md"), "synthetic-foreign-line\n")
  const memory = createMemoryComponent({
    env,
    loadConfig: () => loadedMemoryConfig(memorySettings()),
    resolveCwd: () => cwd,
    createRuntime: () => {
      throw new Error("policy test does not create an identity runtime")
    },
  })
  const logger = { info() {}, warn() {}, error() {} }
  const extension = composeOmoSenpiExtension([memory], { logger, scheduleStartupWork: () => () => undefined })
  const settingsManager = SettingsManager.inMemory({ defaultProjectTrust: "always" })
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [(pi) => extension(pi)],
  })
  await loader.reload()
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    settingsManager,
    modelRegistry: new ModelRegistry(ModelRuntime.createSync({ modelsPath: null })),
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    autoTitleSessions: false,
  })
  await session.bindExtensions({})
  return { session, foreignRepo, cwd }
}

async function outcome(session: Awaited<ReturnType<typeof boundSession>>["session"], name: string, args: object) {
  const tool = session.getRegisteredTool(name)
  if (tool === undefined) throw new Error(`no ${name} tool`)
  return tool.execute(`policy-${name}`, args as never).then(
    (result) => ({ ran: JSON.stringify(result.content) }),
    (error: unknown) => ({ denied: error instanceof Error ? error.message : String(error) }),
  )
}

describe("memory filesystem policy through senpi's runtime (#15251)", () => {
  test("#given the memory component in a real senpi session #when read, ls, grep and find target another identity #then the composed policy denies each and no foreign text comes back", async () => {
    const { session, foreignRepo } = await boundSession()
    try {
      const results = [
        await outcome(session, "read", { path: join(foreignRepo, "system", "persona.md") }),
        await outcome(session, "ls", { path: foreignRepo }),
        await outcome(session, "grep", { pattern: "synthetic", path: foreignRepo }),
        await outcome(session, "find", { pattern: "**/*.md", path: foreignRepo }),
      ]

      for (const result of results) {
        expect(result).toEqual({ denied: expect.stringContaining("cross-identity memory access denied") })
      }
      expect(JSON.stringify(results)).not.toContain("synthetic-foreign-line")
    } finally {
      session.dispose()
      memoryModuleSupervisor.release()
    }
  })

  test("#given the same session #when read targets a file outside the memory areas #then the policy allows it", async () => {
    const { session, cwd } = await boundSession()
    try {
      writeFileSync(join(cwd, "notes.md"), "synthetic project line\n")

      expect(await outcome(session, "read", { path: join(cwd, "notes.md") })).toEqual({
        ran: expect.stringContaining("synthetic project line"),
      })
    } finally {
      session.dispose()
      memoryModuleSupervisor.release()
    }
  })
})
