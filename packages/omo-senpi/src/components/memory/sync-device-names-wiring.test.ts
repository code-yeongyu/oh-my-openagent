// The device names on the "synced from" notice must reach the projection pins through the real
// component wiring (index -> wiring -> static wiring), not only when a test builds the pins itself.
import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import { GitMemoryRepo, resolveMemoryIdentity } from "@oh-my-opencode/memory-core"

import { ensureIdentityRuntimeDirs } from "./context"
import { createMemoryComponent } from "./index"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import type { SyncRunner } from "./sync-runner"
import { rmEfaultTolerant } from "./teardown.test-support"

const SESSION_ID = "session-device-names"
const roots: string[] = []
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

function sessionEventContext(turn: number): unknown {
  return {
    sessionManager: {
      getEntries: () => [],
      getSessionId: () => SESSION_ID,
      getBranch: () => Array.from({ length: turn }, (_, index) => ({ id: `message-${index + 1}` })),
    },
    ui: { notify: () => {} },
  }
}

/** A runner as production builds it, minus the engine: only the device-name lookup is live. */
function runnerKnowing(names: Readonly<Record<string, string>>): SyncRunner {
  return {
    acquire: async () => {},
    release: async () => {},
    status: async () => null,
    deviceName: (principal) => names[principal],
  }
}

async function noticeAfterSync(principals: string): Promise<string> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-device-names-")))
  roots.push(root)
  const cwd = join(root, "project")
  const env = { OMO_MEMORY_HOME: join(root, "memory") }
  const settings = memorySettings()
  const identity = resolveMemoryIdentity(settings.agent, cwd, env)
  const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
  await repo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nbefore\n" }] })
  await ensureIdentityRuntimeDirs(identity.paths)
  const pi = new MemoryFakeExtensionAPI()
  createMemoryComponent({
    env,
    loadConfig: () => loadedMemoryConfig(settings),
    resolveCwd: () => cwd,
    syncRunner: runnerKnowing({ "device:dev-mini": "Mac mini" }),
  }).register(pi, componentContext())
  await pi.dispatch("session_start", { type: "session_start" }, sessionEventContext(1))
  cleanups.push(async () => {
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, sessionEventContext(3))
  })
  const start = (turn: number) =>
    pi.dispatch("before_agent_start", { type: "before_agent_start", prompt: "continue", systemPrompt: "BASE" }, sessionEventContext(turn))
  await start(1)
  const path = join(repo.dir, "system/persona.md")
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, "---\ndescription: Persona\n---\nwritten on the mini\n")
  await repo.commitWrite(["system/persona.md"], `sync: 1 memories updated\n\nSync-Seq: 4-4\nSync-Principals: ${principals}`, {
    agentId: identity.id,
    authorName: "OmO Sync",
  })
  const results = await start(2)
  const result = results.find((r) => (r as BeforeAgentStartEventResult | undefined)?.message !== undefined) as BeforeAgentStartEventResult | undefined
  const content = result?.message?.content
  return typeof content === "string" ? content : JSON.stringify(content ?? "")
}

describe("device names on the synced-from notice, through the real component wiring", () => {
  test("#given the sync runner knows the principal's device name #when a sync commit lands #then the notice names that device", async () => {
    expect(await noticeAfterSync("device:dev-mini")).toContain("synced from Mac mini")
  }, 30_000)

  test("#given an unknown principal #when a sync commit lands #then the notice says another device", async () => {
    expect(await noticeAfterSync("device:dev-unknown")).toContain("synced from another device")
  }, 30_000)
})
