import { afterEach, describe, expect, test } from "bun:test"

import type { AccountHttp, PairingHttp, PendingApproval } from "../../memory-core/src/sync/account/index.ts"
import { createInMemoryDeviceKeyring } from "../../memory-core/src/sync/keyring-port"
import { Command } from "commander"

import { SignInError } from "../../omo-opencode/src/cli/service-auth/protocol"
import { configureSyncCommands, EXIT_UNSUPPORTED_HERE, type SyncCommandDependencies } from "../sync-cli"
import type { SyncContext } from "../sync-context"

const initialExitCode = process.exitCode
afterEach(() => {
  process.exitCode = initialExitCode
})

const unused = (): never => {
  throw new Error("not used by this case")
}

function context(overrides: { readonly keys?: number; readonly pending?: PendingApproval[]; readonly switches?: string[] } = {}): SyncContext {
  const switches = overrides.switches ?? []
  const chain: AccountHttp = {
    listKeys: async () => Array.from({ length: overrides.keys ?? 0 }, unused),
    listEntries: unused, listEntriesAfter: unused, listRecoveryWraps: unused, appendKeys: unused, recoveryJoin: unused, state: unused,
  }
  const pairing: PairingHttp = {
    setAccountSync: async (enabled) => { switches.push(`account ${enabled}`) },
    setDeviceSync: async (id, enabled) => { switches.push(`device ${id} ${enabled}`) },
    listPending: async () => overrides.pending ?? [],
    openPending: unused, readPending: unused, answerPending: unused, revealPending: unused,
  }
  return { account: "acct", serviceDeviceId: "dev_svc", keyring: createInMemoryDeviceKeyring("p"), pinDir: "/nonexistent-pins", chain, pairing }
}

async function runSync(args: string[], dependencies: Partial<SyncCommandDependencies>): Promise<{ readonly out: string[]; readonly err: string[]; readonly exit: typeof process.exitCode }> {
  const out: string[] = []
  const err: string[] = []
  const program = new Command("omo").exitOverride()
  configureSyncCommands(program, {
    context: async () => context(),
    clock: { now: () => 0, sleep: async () => undefined },
    output: (line) => out.push(line),
    error: (line) => err.push(line),
    confirm: async () => false,
    interactive: true,
    ...dependencies,
  })
  await program.parseAsync(args, { from: "user" })
  return { out, err, exit: process.exitCode }
}

describe("omo sync", () => {
  test("recover points at the desktop passkey flow or approval from another device, and exits 2", async () => {
    const result = await runSync(["sync", "recover"], {})
    expect(result.exit).toBe(EXIT_UNSUPPORTED_HERE)
    expect(result.err.join("\n")).toContain("omo sync approve")
  })

  test("enable on an account with no synced memory turns the switches on, then explains the first device and exits 2", async () => {
    const switches: string[] = []
    const result = await runSync(["sync", "enable"], { context: async () => context({ keys: 0, switches }) })
    expect(switches).toEqual(["account true", "device dev_svc true"])
    expect(result.exit).toBe(EXIT_UNSUPPORTED_HERE)
  })

  test("approve refuses without an interactive terminal, because the person must compare the codes", async () => {
    const result = await runSync(["sync", "approve"], { interactive: false })
    expect(result.exit).toBe(1)
  })

  test("approve with nothing waiting says so; with two waiting it asks which one", async () => {
    expect((await runSync(["sync", "approve"], {})).exit).toBe(1)
    const row = (id: string): PendingApproval => ({ id, account: "acct", commitment: "c", answer: null, reveal: null, expires_at: 1 })
    const two = await runSync(["sync", "approve"], { context: async () => context({ pending: [row("one"), row("two")] }) })
    expect(two.exit).toBe(1)
    expect(two.err.join("\n")).toContain("one, two")
  })

  test("a signed-out device is told to sign in, with exit 1", async () => {
    const result = await runSync(["sync", "enable"], { context: async () => { throw new SignInError("Not signed in. Run omo login first.") } })
    expect(result).toMatchObject({ exit: 1, err: ["Not signed in. Run omo login first."] })
  })
})
