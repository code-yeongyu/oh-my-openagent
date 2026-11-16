import { afterEach } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { connectDeviceService } from "../../device-service-core/src/index.ts"
import { type FakeOwner, startFakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../device-service-core/test/local-api/conformance/world.ts"
import type { RemoteClient } from "../../omo-senpi/src/components/remote/client"
import type { RemoteThreadSurface } from "../../omo-senpi/src/components/thread/remote/ports"
import type { BootstrapSetup, DeviceLink } from "../remote-bootstrap"
import { runRemoteVerb } from "../remote-cli"
import type { ColdWake } from "../remote-cold-wake"

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
        install: async () => (coldWake.push("install"), { kind: "installed", serviceRestarted: false }),
        uninstall: async () => (coldWake.push("uninstall"), { kind: "removed", serviceRestarted: false }),
        status: async () => undefined,
      },
      linkDevice: async () => {
        throw new Error("this test links no device")
      },
      ...(remote === undefined ? {} : { remote: () => remote }),
      ...extra,
    },
    args,
  )
  return { code, out, err, written, coldWake }
}
