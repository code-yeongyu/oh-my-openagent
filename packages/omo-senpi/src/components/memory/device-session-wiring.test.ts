// A signed-in device must reach the production sync session resolver through the real component
// (index -> session binding -> sync runner -> device-session resolver), not only when a test builds
// the runner itself. Before #10625 the component built its runner with no resolver, so a signed-in
// device logged "sync idle: no device session" exactly like a signed-out one.
import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo, resolveMemoryIdentity } from "@oh-my-opencode/memory-core"

import { ensureIdentityRuntimeDirs } from "./context"
import type { DeviceAccountSource } from "./device-session/account-source"
import { createMemoryComponent } from "./index"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { SYNC_IDLE_NO_DEVICE_SESSION, SYNC_IDLE_NOT_JOINED } from "./sync-runner"
import { rmEfaultTolerant } from "./teardown.test-support"

const SESSION_ID = "session-device-session"
const roots: string[] = []
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

const sessionEventContext = (): unknown => ({
  sessionManager: { getEntries: () => [], getSessionId: () => SESSION_ID, getBranch: () => [] },
  ui: { notify: () => {} },
  hasUI: true,
})

const signedIn: DeviceAccountSource = async () => ({
  api: "http://127.0.0.1:9",
  accountId: "acct-wiring",
  keyring: async (build) => {
    const { generateDeviceKeyMaterial } = await import("@oh-my-opencode/memory-core/keyring")
    const { signingPrivatePkcs8, sealingPrivatePkcs8 } = generateDeviceKeyMaterial()
    return build({ signingPrivatePkcs8, sealingPrivatePkcs8 })
  },
  accessToken: async () => "token",
  signedOut: async () => false,
})

async function syncLinesAfterBind(source: DeviceAccountSource): Promise<{ readonly message: string; readonly fields: unknown }[]> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-device-session-")))
  roots.push(root)
  const cwd = join(root, "project")
  const env = { OMO_MEMORY_HOME: join(root, "memory") }
  const settings = memorySettings()
  const identity = resolveMemoryIdentity(settings.agent, cwd, env)
  await new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id }).init({ seedFiles: [{ relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nhi\n" }] })
  await ensureIdentityRuntimeDirs(identity.paths)
  const lines: { message: string; fields: unknown }[] = []
  const settled = new Promise<void>((resolve) => {
    const record = (message: string, fields?: unknown) => {
      lines.push({ message, fields })
      if (message.startsWith("sync idle")) resolve()
    }
    const ctx = componentContext()
    const pi = new MemoryFakeExtensionAPI()
    createMemoryComponent({ env, loadConfig: () => loadedMemoryConfig(settings), resolveCwd: () => cwd, deviceAccount: source })
      .register(pi, { ...ctx, logger: { ...ctx.logger, info: record } })
    cleanups.push(async () => {
      await pi.dispatch("session_shutdown", { type: "session_shutdown" }, sessionEventContext())
    })
    void pi.dispatch("session_start", { type: "session_start" }, sessionEventContext())
  })
  await Promise.race([settled, new Promise((_, reject) => setTimeout(() => reject(new Error("waited 20s for a 'sync idle' line, none was logged")), 20_000))])
  return lines.filter((line) => line.message.startsWith("sync idle"))
}

describe("the production device-session resolver, through the real memory component", () => {
  test("#given a signed-in device that never joined the account's memory #when a session binds #then sync reports not-joined, not 'no device session'", async () => {
    const lines = await syncLinesAfterBind(signedIn)
    expect(lines.map((line) => line.message)).toEqual([SYNC_IDLE_NOT_JOINED])
    expect(lines[0]?.fields).toMatchObject({ reason: "no_pin" })
  }, 30_000)

  test("#given a signed-out device #when a session binds #then sync stays idle with no device session", async () => {
    const lines = await syncLinesAfterBind(async () => null)
    expect(lines.map((line) => line.message)).toEqual([SYNC_IDLE_NO_DEVICE_SESSION])
  }, 30_000)
})
