import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveMemoryIdentity } from "@oh-my-opencode/memory-core"

import { createMemoryComponent, ensureIdentityRuntimeDirs } from "./index"
import { memoryUsagePaths, readMemoryUsageLedger } from "./memory-usage-ledger"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { readSkillsUsageLedger, skillsUsagePaths } from "./skills-usage-ledger"
import { rmEfaultTolerant } from "./teardown.test-support"

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rmEfaultTolerant(root, { recursive: true, force: true })
})

// Senpi calls a tool_call handler with the event first and the session-bound extension context
// second; only the context carries the session manager (#8864).
function extensionContext(sessionId: string): unknown {
  return {
    sessionManager: {
      getBranch: () => [],
      getEntries: () => [],
      getSessionId: () => sessionId,
    },
    ui: { notify: () => {} },
  }
}

function readToolCall(path: string): Record<string, unknown> {
  return { type: "tool_call", toolCallId: `call-${path}`, toolName: "read", input: { path } }
}

describe("memory usage ledgers through the registered memory component", () => {
  test("#given a bound session #when read tool calls hit a memory skill and a reference file #then both ledgers record them when the host quits", async () => {
    // #given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-usage-ledgers-")))
    roots.push(root)
    const cwd = join(root, "project")
    const env = { OMO_MEMORY_HOME: join(root, "memory") }
    const identity = resolveMemoryIdentity("auto", cwd, env)
    await ensureIdentityRuntimeDirs(identity.paths)
    const skillFile = join(identity.paths.repo, "skills", "probe", "SKILL.md")
    const referenceFile = join(identity.paths.repo, "reference", "probe.md")
    await mkdir(join(identity.paths.repo, "skills", "probe"), { recursive: true })
    await mkdir(join(identity.paths.repo, "reference"), { recursive: true })
    await writeFile(skillFile, "# Probe skill\n")
    await writeFile(referenceFile, "# Probe reference\n")
    const pi = new MemoryFakeExtensionAPI()
    createMemoryComponent({
      env,
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      resolveCwd: () => cwd,
    }).register(pi, componentContext())
    const ctx = extensionContext("session-usage-ledgers")
    await pi.dispatch("session_start", { type: "session_start" }, ctx)

    // #when
    await pi.dispatch("tool_call", readToolCall(skillFile), ctx)
    await pi.dispatch("tool_call", readToolCall(referenceFile), ctx)
    // Only a quitting host flushes the ledgers in the shutdown drain; the debounce covers the rest.
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx)

    // #then
    const skills = await readSkillsUsageLedger(skillsUsagePaths(identity.paths).ledgerPath)
    const memory = await readMemoryUsageLedger(memoryUsagePaths(identity.paths).ledgerPath)
    expect(skills.probe?.count).toBe(1)
    expect(memory["reference/probe.md"]?.count).toBe(1)
  }, 30_000)
})
