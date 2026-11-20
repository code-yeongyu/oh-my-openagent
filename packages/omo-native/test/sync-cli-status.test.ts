import { afterEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"

import type { AccountHttp, PairingHttp, PendingApproval } from "../../memory-core/src/sync/account/index.ts"
import { trustAnchorDir } from "../../memory-core/src/sync/device-retire.ts"
import { createInMemoryDeviceKeyring } from "../../memory-core/src/sync/keyring-port"
import { Command } from "commander"

import { temporaryHome } from "../../omo-opencode/src/cli/service-auth/test-support"
import { configureSyncCommands } from "../sync-cli"
import type { SyncContext } from "../sync-context"
import { type EngineSyncRead, parseEngineAnswer, readEngineSyncStatus } from "../sync-engine-status"

const initialExitCode = process.exitCode
afterEach(() => {
  process.exitCode = initialExitCode ?? 0
})

const unused = (): never => {
  throw new Error("not used by this case")
}

const DEVICES = {
  devices: [
    {
      id: "dev_svc",
      name: "laptop",
      syncing: true,
      lastSeenAt: "2026-11-20T01:00:00.000Z",
      current: true,
      revokedAt: null,
    },
    { id: "dev_b", name: "desk", syncing: false, lastSeenAt: "2026-11-19T01:00:00.000Z", revokedAt: null },
    { id: "dev_gone", name: "old", syncing: true, revokedAt: "2026-11-01T00:00:00.000Z" },
  ],
}

const PENDING: PendingApproval = {
  id: "pend_1",
  account: "acct",
  commitment: "c",
  answer: null,
  reveal: null,
  expires_at: Date.parse("2026-11-20T02:00:00.000Z"),
}

async function context(
  options: { readonly joined?: boolean; readonly off?: boolean; readonly devices?: () => Promise<unknown> } = {},
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

const SYNCED: EngineSyncRead = {
  kind: "read",
  sync: { state: "synced", lastSyncedAtISO: "2026-11-20T01:30:00.000Z", appliedWhileOffline: 3 },
}

describe("omo sync status", () => {
  test("reports account, join, switch, live devices, pending joins and the engine as JSON", async () => {
    // given a joined device with sync on, three listed devices (one revoked), one pending join and a synced engine
    const ctx = await context({ joined: true })
    // when status runs with --json
    const { out, exit } = await status(["--json"], ctx, SYNCED)
    // then one typed object carries every section and drops the revoked device
    expect(exit).toBe(0)
    expect(JSON.parse(out.join(""))).toEqual({
      account: "acct",
      device: { id: "dev_svc", joined: true, switch: "on" },
      devices: {
        ok: true,
        list: [
          { id: "dev_svc", name: "laptop", syncing: true, lastSeenAt: "2026-11-20T01:00:00.000Z", current: true },
          { id: "dev_b", name: "desk", syncing: false, lastSeenAt: "2026-11-19T01:00:00.000Z", current: false },
        ],
      },
      pending: { ok: true, list: [{ id: "pend_1", expiresAt: "2026-11-20T02:00:00.000Z", answered: false }] },
      engine: SYNCED,
    })
  })

  test("a device that is not joined and switched off says so, and no engine is reported as such", async () => {
    // given no trust pin, the local off mark, and no engine
    const ctx = await context({ off: true })
    // when status runs
    const { out, exit } = await status([], ctx, { kind: "no_engine" })
    // then the human lines name both facts and the missing engine
    expect(exit).toBe(0)
    expect(out).toContain("This device: dev_svc, not joined, sync off")
    expect(out).toContain("Engine: no engine is running on this machine.")
    expect(out).toContain("Pending join requests:")
    expect(out).toContain("  pend_1: expires 2026-11-20T02:00:00.000Z, waiting")
  })

  test("a failing engine shows its reason, last cycle and held files", async () => {
    // given an engine holding two files
    const engine = parseEngineAnswer({
      sync: {
        state: "paused",
        failure: {
          kind: "unknown",
          reason: "two files are too large",
          action: "shrink them",
          sinceISO: "2026-11-20T00:00:00.000Z",
          attempts: 4,
          keys: ["a.md", "b.md"],
        },
      },
    })
    // when status runs
    const { out } = await status([], await context({ joined: true }), engine)
    // then each engine field is printed
    expect(out).toEqual(
      expect.arrayContaining([
        "  state: paused",
        "  reason: two files are too large",
        "  since: 2026-11-20T00:00:00.000Z (4 attempts)",
        "  held files: a.md, b.md",
      ]),
    )
  })

  test("a device list the service refuses is reported without failing the whole status", async () => {
    // given a device list that throws
    const ctx = await context({
      devices: async () => {
        throw new Error("service answered 503")
      },
    })
    // when status runs
    const { out, exit } = await status([], ctx, { kind: "no_session" })
    // then the other sections still print and the devices line names the reason
    expect(exit).toBe(0)
    expect(out).toContain("Devices: could not be read (service answered 503).")
    expect(out).toContain("Engine: running, but it has no open session to read sync status from.")
  })

  test.skipIf(process.platform === "win32")(
    "the operator socket decides no_engine: absent, or a leftover file nobody listens on",
    async () => {
      // given an agent dir with no socket, then one with a stale non-socket file at the socket path
      const home = await temporaryHome()
      const socket = `${home}/rpc.sock`
      // when the engine is read through that socket
      const absent = await readEngineSyncStatus({ OMO_CODING_AGENT_DIR: home, OMO_RPC_SOCKET: socket })
      await Bun.write(socket, "")
      const stale = await readEngineSyncStatus({ OMO_CODING_AGENT_DIR: home, OMO_RPC_SOCKET: socket })
      // then both report that no engine is running
      expect(absent).toEqual({ kind: "no_engine" })
      expect(stale).toEqual({ kind: "no_engine" })
    },
  )

  test("an engine answer of the wrong shape is unreadable, not a crash", () => {
    expect(parseEngineAnswer({ sync: { state: "exploded" } }).kind).toBe("unreadable")
    expect(parseEngineAnswer({})).toEqual({ kind: "read", sync: null })
  })
})
