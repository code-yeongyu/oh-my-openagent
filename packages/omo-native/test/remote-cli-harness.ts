import { afterEach } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { connectDeviceService } from "../../device-service-core/src/index.ts"
import { type FakeOwner, startFakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../device-service-core/test/local-api/conformance/world.ts"
import type { RemoteClient } from "../../omo-senpi/src/components/remote/index"
import type { Credentials } from "../../omo-opencode/src/cli/service-auth/protocol"
import type { RemoteThreadSurface } from "../../omo-senpi/src/components/thread/remote/ports"
import { createLocalSessions } from "../../omo-senpi/src/components/remote/local-sessions"
import type { ThreadHost } from "../../omo-senpi/src/components/thread/tools/ports"
import type { BootstrapSetup, DeviceLink } from "../remote-bootstrap"
import { runRemoteVerb } from "../remote-cli"
import type { ColdWake } from "../remote-cold-wake"
import type { RemoteOptOut } from "../remote-opt-out"

// The `omo remote` test harness: the real verbs over a fake device service (the conformance owner), with this omo's
// sign-in, bootstrap and session host unit as seams. Shared by every remote-cli test file.

export const NOW = 1_790_000_400_000
export const owners: FakeOwner[] = []
const dirs: string[] = []

/** Each test file calls this once: it stops the fake owners and removes the dirs its tests made. */
export function useRemoteCliCleanup(): void {
  afterEach(async () => {
    for (const owner of owners.splice(0)) await owner.stop()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
}

export const privateDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "rcli-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  return dir
}

export const SIGNED_IN = {
  exitCode: 0,
  stdout: JSON.stringify({ signedIn: true, device: { id: "dev-self", name: "This Mac" }, refreshState: "ok" }),
}

export const AGENT_DIR = "/home/user/.omo/agent"
export const OMO_BINARY = "/opt/omo/bin/omo"

// The fake owner serves service_version 1.4.0, so pinning 1.4.0 makes a running owner current.
export const testBootstrap = (overrides: Partial<BootstrapSetup> = {}): BootstrapSetup => ({
  pinVersion: "1.4.0",
  install: async () => ({ ok: false, state: "service_degraded", action: "This test installs nothing." }),
  refresher: { binaryPath: OMO_BINARY, version: "5.1.58" },
  agentDir: AGENT_DIR,
  ...overrides,
})

const unused = async (): Promise<never> => {
  throw new Error("this test drives no session on this device")
}

// This device's operator endpoint as every harness test sees it: it answers at once and holds no session. Without it,
// `sessions` reads the machine's real endpoint under the listing's real 10 s local bound, so a loaded host lists this
// device as unanswered (#14113), and an unisolated HOME lists the host's own sessions.
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

export async function run(
  args: readonly string[],
  stateDir?: string,
  account = SIGNED_IN,
  bootstrap = testBootstrap(),
  remote?: RemoteThreadSurface,
  extra: {
    readonly packageRoot?: string
    readonly coldWake?: ColdWake
    readonly linkDevice?: DeviceLink
    readonly client?: () => RemoteClient
    readonly optOut?: RemoteOptOut
  } = {},
) {
  let dir = stateDir
  if (dir === undefined) {
    const owner = await startFakeOwner({ stateDir: privateDir(), world: defaultWorld() })
    owners.push(owner)
    dir = owner.stateDir
  }
  const out: string[] = []
  const err: string[] = []
  const written: string[] = []
  const coldWake: string[] = []
  const target = dir
  const code = await runRemoteVerb(
    {
      accountShow: async () => account,
      stateDir: target,
      connect: () => connectDeviceService({ version: "5.1.52", stateDir: target }),
      now: () => NOW,
      output: (line) => out.push(line),
      write: (text) => written.push(text),
      error: (line) => err.push(line),
      bootstrap,
      coldWake: {
        install: async () => {
          coldWake.push("install")
          return { kind: "installed", serviceRestarted: false }
        },
        uninstall: async () => {
          coldWake.push("uninstall")
          return { kind: "removed", serviceRestarted: false }
        },
        status: async () => undefined,
      },
      linkDevice: async () => {
        throw new Error("this test links no device")
      },
      optOut: { read: () => false, record: () => {}, clear: () => {} },
      localSessions: async () => createLocalSessions(async () => noLocalSessions),
      ...(remote === undefined ? {} : { remote: () => remote }),
      ...extra,
    },
    args,
  )
  return { code, out, err, written, coldWake }
}

/** A signed-in session's credential with real key material, as the device link hands it over. */
export const signedInCredential = (): Credentials => ({
  accessToken: "access-1",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  refreshToken: "refresh-1",
  device: { id: "dev-self", name: "This Mac" },
  accountId: "acct-1",
  signingPrivateKey: generateKeyPairSync("ed25519")
    .privateKey.export({ format: "der", type: "pkcs8" })
    .toString("base64"),
  sealingPrivateKey: generateKeyPairSync("x25519")
    .privateKey.export({ format: "der", type: "pkcs8" })
    .toString("base64"),
})
