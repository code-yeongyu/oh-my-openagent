import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { createThreadSdk } from "../../omo-senpi/src/extension/thread-sdk"
import type { ThreadSdkOptions } from "../../omo-senpi/src/components/thread/sdk"
import type { ThreadHost } from "../../omo-senpi/src/components/thread/tools/ports"
import { createRemoteThreadFixture } from "../../omo-senpi/src/components/thread/thread-remote-fixture"
import { runThreadCommand, THREAD_EXIT } from "../bin/lib/thread.js"

// #14755: `omo thread` runs the plugin's real thread SDK; another device's typed refusal of a control (here a read whose
// reply the device service lost, `request_gone`) must reach the CLI as the same code the thread_read tool answers.

const fixture = createRemoteThreadFixture()
const dirs: string[] = []
afterEach(async () => {
  await fixture.cleanup()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const unused = async (): Promise<never> => {
  throw new Error("this test drives no session on this device")
}

const noLocalSessions: ThreadHost = {
  socket: "no-local-endpoint.sock",
  listSessions: async () => [],
  openSession: unused,
  getMessages: unused,
  getState: unused,
  prompt: unused,
  interrupt: unused,
  setSessionName: unused,
  setModel: unused,
  getAvailableModels: unused,
  setThinkingLevel: unused,
  getAvailableThinkingLevels: unused,
}

function capture() {
  const chunks: string[] = []
  return { write: (text: string) => void chunks.push(text), text: () => chunks.join("") }
}

async function cliRead(thread: string, remote: ThreadSdkOptions["remote"]) {
  const agentDir = mkdtempSync(join(tmpdir(), "omo-thread-cli-refusal-"))
  dirs.push(agentDir)
  const stdout = capture()
  const stderr = capture()
  const exitCode = await runThreadCommand(["read", thread, "--json"], {
    engine: { run: () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    pluginRoot: "/plugin",
    agentDir,
    env: {},
    cwd: agentDir,
    stdout,
    stderr,
    platform: "linux",
    loadSqlite: async () => ({}),
    importSdk: async () => ({
      createThreadSdk: (options: ThreadSdkOptions) => createThreadSdk({ ...options, host: noLocalSessions }),
    }),
    importThreadClient: async () => ({ createCliRemoteSurface: () => remote }),
    identity: { uid: 501, user: "qa" },
  })
  return { exitCode, result: JSON.parse(stdout.text()), stderr: stderr.text() }
}

describe("omo thread read: another device's typed refusal", () => {
  test("#given b's device service lost the read's reply (request_gone) #when omo thread read names b's thread #then it answers host_unavailable naming b, exit 3, exactly as the thread_read tool does", async () => {
    // The CLI's remote surface carries no transcript projector, so a read of b takes get_messages (createCliRemoteSurface).
    const { loadProjector: _projector, ...remote } = fixture.account({ refuse: "request_gone" }).remote
    const tool = await fixture.surface(remote).run("thread_read", { thread: "dur-on-b" })
    expect(tool).toMatchObject({ kind: "error", error: { code: "host_unavailable", details: { device: "b" } } })

    const cli = await cliRead("dur-on-b", remote)

    expect(cli.result).toEqual(tool)
    expect(cli.exitCode).toBe(THREAD_EXIT.unavailable)
  })
})
