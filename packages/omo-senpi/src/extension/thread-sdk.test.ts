import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { startFakeOwner, type FakeOwner } from "@oh-my-opencode/device-service-core/conformance/fake-owner"
import { defaultWorld, PEER } from "@oh-my-opencode/device-service-core/conformance/world"

import type { ThreadHost } from "../components/thread/tools/ports"
import { createThreadSdk } from "./thread-sdk"

const STATE_DIR_ENV = "OMO_DEVICE_SERVICE_STATE_DIR"
const savedStateDir = process.env[STATE_DIR_ENV]
const cleanups: Array<() => Promise<void> | void> = []
const HOST_SOCKET = "/tmp/thread-sdk-entry-host.sock"
const unused = async (): Promise<never> => {
  throw new Error("not used by a listing")
}
// This device runs one host with no sessions: the only threads to list are the other device's.
const emptyHost: ThreadHost = {
  socket: HOST_SOCKET,
  listSessions: async () => [],
  listView: async () => ({
    sessions: [],
    hosts: [{ socket: HOST_SOCKET, list_sessions: { sessions: [] }, endpoint_kind: "rpc_host", alive: true }],
    disk: [],
  }),
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
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  if (savedStateDir === undefined) delete process.env[STATE_DIR_ENV]
  else process.env[STATE_DIR_ENV] = savedStateDir
})

// #14616: a script that imports the shipped SDK and passes no `remote` (a connector, a lane monitor) saw this device's
// daemon only, so a live thread on another device of the same account read not_found. The `omo thread` CLI never hit it
// because it builds its own remote surface; the SDK entry now builds the same account surface for every other caller.
test("#given a script that opens the shipped SDK without a remote #when it lists every scope #then the account's other device is listed through the device service", async () => {
  const root = mkdtempSync(join(tmpdir(), "thread-sdk-entry-"))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const stateDir = join(root, "device-service")
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  // An empty account listing keeps the alias registry (the account sign-in) out of the run: no row asks it.
  const owner: FakeOwner = await startFakeOwner({
    stateDir,
    world: { ...defaultWorld(), listing: { revisions: [{ rows: [], incomplete: [] }], devices: {} } },
  })
  cleanups.push(() => owner.stop())
  process.env[STATE_DIR_ENV] = stateDir
  const agentDir = join(root, "agent")
  mkdirSync(agentDir, { recursive: true })

  const sdk = createThreadSdk({ agentDir, cwd: agentDir, uid: 501, user: "lane-monitor", host: emptyHost })
  cleanups.push(() => sdk.dispose())
  const listed = await sdk.list({ all_scope: true })

  expect(listed).toMatchObject({ kind: "ok" })
  const devices = listed.kind === "ok" && "devices" in listed ? (listed.devices ?? []) : []
  expect(devices.map((device) => device.device)).toContain(PEER)
})
