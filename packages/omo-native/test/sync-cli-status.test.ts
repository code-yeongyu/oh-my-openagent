import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir } from "node:fs/promises"
import { createServer } from "node:net"

import type { AccountHttp, PairingHttp, PendingApproval } from "../../memory-core/src/sync/account/index.ts"
import { trustAnchorDir } from "../../memory-core/src/sync/device-retire.ts"
import { createInMemoryDeviceKeyring } from "../../memory-core/src/sync/keyring-port"
import { Command } from "commander"

import type { LiveDevice } from "../../omo-opencode/src/cli/service-auth/devices"
import { temporaryHome } from "../../omo-opencode/src/cli/service-auth/test-support"
import { configureSyncCommands } from "../sync-cli"
import type { SyncContext } from "../sync-context"
import { type EngineSyncRead, readEngineSyncStatus } from "../sync-engine-status"

const initialExitCode = process.exitCode
afterEach(() => {
  process.exitCode = initialExitCode ?? 0
})

const unused = (): never => {
  throw new Error("not used by this case")
}

const DEVICES: LiveDevice[] = [
  { id: "dev_svc", name: "laptop", syncing: true, lastSeenAt: "2026-11-20T01:00:00.000Z", current: true },
  { id: "dev_b", name: "desk", syncing: false, lastSeenAt: "2026-11-19T01:00:00.000Z", current: false },
  { id: "dev_old", name: "old", current: false },
]

const PENDING: PendingApproval = {
  id: "pend_1",
  account: "acct",
  commitment: "c",
  answer: null,
  reveal: null,
  expires_at: Date.parse("2026-11-20T02:00:00.000Z"),
}

async function context(
  options: { readonly joined?: boolean; readonly off?: boolean; readonly devices?: SyncContext["listDevices"] } = {},
): Promise<SyncContext> {
  const pinDir = await temporaryHome()
  if (options.joined === true) await mkdir(trustAnchorDir(pinDir, "acct"), { recursive: true })
  if (options.off === true) {
    const { trustAnchorKey } = await import("../../memory-core/src/sync/device-retire.ts")
    await mkdir(`${pinDir}/sync-off`, { recursive: true })
    await Bun.write(`${pinDir}/sync-off/${trustAnchorKey("acct")}`, "")
  }
  const chain = {} as AccountHttp
  const pairing: PairingHttp = {
    listPending: async () => [PENDING],
    setAccountSync: unused,
    setDeviceSync: unused,
    disableDeviceSync: unused,
    openPending: unused,
    readPending: unused,
    answerPending: unused,
    revealPending: unused,
  }
  return {
    account: "acct",
    serviceDeviceId: "dev_svc",
    keyring: createInMemoryDeviceKeyring("p"),
    pinDir,
    chain,
    pairing,
    authority: { signal: new AbortController().signal, admit: <T>(dispatch: () => T): T => dispatch() },
    listDevices: options.devices ?? (async () => DEVICES),
  }
}

async function status(args: string[], ctx: SyncContext, engine: EngineSyncRead) {
  const out: string[] = []
  const err: string[] = []
  const program = new Command("omo").exitOverride()
  configureSyncCommands(program, {
    context: async () => ctx,
    clock: { now: () => 0, sleep: async () => undefined },
    output: (line) => out.push(line),
    error: (line) => err.push(line),
    confirm: async () => false,
    interactive: false,
    env: {},
    terminalAvailable: () => false,
    engineStatus: async () => engine,
  })
  await program.parseAsync(["sync", "status", ...args], { from: "user" })
  return { out, err, exit: process.exitCode }
}

const RUNNING: EngineSyncRead = { kind: "running" }

describe("omo sync status", () => {
  test("reports account, join, switch, the account's devices, pending joins and the engine as JSON", async () => {
    // given a joined device with sync on, three live devices (one from a service without the newer fields), one pending join
    const ctx = await context({ joined: true })
    // when status runs with --json
    const { out, exit } = await status(["--json"], ctx, RUNNING)
    // then one typed object carries every section
    expect(exit).toBe(0)
    expect(JSON.parse(out.join(""))).toEqual({
      account: "acct",
      deviceId: "dev_svc",
      device: { ok: true, joined: true, switch: "on" },
      devices: {
        ok: true,
        list: [
          { id: "dev_svc", name: "laptop", syncing: true, lastSeenAt: "2026-11-20T01:00:00.000Z", current: true },
          { id: "dev_b", name: "desk", syncing: false, lastSeenAt: "2026-11-19T01:00:00.000Z", current: false },
          { id: "dev_old", name: "old", current: false },
        ],
      },
      pending: { ok: true, list: [{ id: "pend_1", expiresAt: "2026-11-20T02:00:00.000Z", answered: false }] },
      engine: RUNNING,
    })
  })

  test("a device that is not joined and switched off says so, and no engine is reported as such", async () => {
    // given no trust pin, the local off mark, and no engine
    const ctx = await context({ off: true })
    // when status runs
    const { out, exit } = await status([], ctx, { kind: "no_engine" })
    // then the human lines name both facts, the unknown membership and the missing engine
    expect(exit).toBe(0)
    expect(out).toContain("This device: dev_svc, not joined, sync off")
    expect(out).toContain("    old (dev_old): sync unknown")
    expect(out).toContain("  pend_1: expires 2026-11-20T02:00:00.000Z, waiting")
    expect(out).toContain("Engine: no engine is running on this machine.")
  })

  test("a refused device list reports its own reason and leaves the other sections readable", async () => {
    // given a device list that throws
    const ctx = await context({
      devices: async () => {
        throw new Error("service answered 503")
      },
    })
    // when status runs
    const { out, exit } = await status([], ctx, RUNNING)
    // then the command still succeeds, the device list names why, and the local and pending sections still report
    expect(exit).toBe(0)
    expect(out).toContain("Devices: could not be read (service answered 503).")
    expect(out).toContain("This device: dev_svc, not joined, sync on")
    expect(out).toContain("  pend_1: expires 2026-11-20T02:00:00.000Z, waiting")
  })

  // Search permission is a POSIX mode bit; Windows has no mode bits, so chmod cannot make a directory unreadable there.
  test.skipIf(process.platform === "win32")(
    "a pin dir this user cannot search reports its own reason and leaves the other sections readable",
    async () => {
      // given a pin dir with its search bit removed
      const ctx = await context()
      await chmod(ctx.pinDir, 0o000)
      try {
        // when status runs
        const { out, exit } = await status([], ctx, RUNNING)
        // then the command still succeeds and the local section names why (root bypasses mode bits, so it reads fine)
        expect(exit).toBe(0)
        expect(out.some((line) => line.startsWith("This device: dev_svc, local sync state could not be read ("))).toBe(
          process.getuid?.() !== 0,
        )
        expect(out).toContain("    desk (dev_b): not syncing, last seen 2026-11-19T01:00:00.000Z")
        expect(out).toContain("  pend_1: expires 2026-11-20T02:00:00.000Z, waiting")
      } finally {
        await chmod(ctx.pinDir, 0o700)
      }
    },
  )

  test.skipIf(process.platform === "win32")(
    "the operator socket decides: absent or a leftover file is no engine, a listener is running and receives nothing",
    async () => {
      // given an agent dir with no socket, then a stale regular file at the path, then a real listener
      const home = await temporaryHome()
      const socket = `${home}/rpc.sock`
      const env = { OMO_CODING_AGENT_DIR: home, OMO_RPC_SOCKET: socket }
      // when the engine is read through that socket each time
      const absent = await readEngineSyncStatus(env)
      await Bun.write(socket, "")
      const stale = await readEngineSyncStatus(env)
      await Bun.file(socket).delete()
      const received: Buffer[] = []
      const closed = Promise.withResolvers<void>()
      const server = createServer((connection) => {
        connection.on("data", (chunk: Buffer) => received.push(chunk))
        connection.on("close", () => closed.resolve())
      })
      await new Promise<void>((resolve) => server.listen(socket, resolve))
      try {
        const running = await readEngineSyncStatus(env)
        await Promise.race([
          closed.promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("waited 5s for the probe to close")), 5_000)),
        ])
        // then only the listener reads as running, and the probe sent no request (no auth, no attach)
        expect(absent).toEqual({ kind: "no_engine" })
        expect(stale).toEqual({ kind: "no_engine" })
        expect(running).toEqual({ kind: "running" })
        expect(Buffer.concat(received).length).toBe(0)
        // and a socket this user may not open is "could not be checked", never "no engine"
        if (process.getuid?.() !== 0) {
          await chmod(socket, 0o000)
          expect((await readEngineSyncStatus(env)).kind).toBe("unreadable")
        }
      } finally {
        server.close()
      }
    },
  )
})
