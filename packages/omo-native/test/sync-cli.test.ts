import { afterEach, describe, expect, test } from "bun:test"

import type { AccountHttp, PairingHttp, PendingApproval } from "../../memory-core/src/sync/account/index.ts"
import { createInMemoryDeviceKeyring } from "../../memory-core/src/sync/keyring-port"
import { Command } from "commander"

import { ApiRefusal, refusalGuidance, SignInError } from "../../omo-opencode/src/cli/service-auth/protocol"
import { fakeApi, grant, memorySecrets, privateKeys, refusal, temporaryHome } from "../../omo-opencode/src/cli/service-auth/test-support"
import { configureSyncCommands, EXIT_UNSUPPORTED_HERE, type SyncCommandDependencies } from "../sync-cli"
import { signedInSyncContext, type SyncContext } from "../sync-context"

const initialExitCode = process.exitCode
afterEach(() => {
  process.exitCode = initialExitCode ?? 0
})

const unused = (): never => {
  throw new Error("not used by this case")
}

async function context(overrides: { readonly keys?: number; readonly pending?: PendingApproval[]; readonly switches?: string[] } = {}): Promise<SyncContext> {
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
  return { account: "acct", serviceDeviceId: "dev_svc", keyring: createInMemoryDeviceKeyring("p"), pinDir: await temporaryHome(), chain, pairing }
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
  test.each([
    ["forbidden", 403, "account_refused"],
    ["entitlement_required", 403, "account_refused"],
    ["account_deleted", 410, "account_deleted"],
    ["unauthorized", 401, "sign_in_again"],
    ["unrecognized", 403, "account_refused"],
  ] as const)("maps /v1/me refusal %s through shared guidance", async (code, status, guidance) => {
    // given a valid local sign-in and a service refusal
    const api = fakeApi(() => refusal(code, undefined, status))
    const store = memorySecrets().store(api)
    await store.write({ ...grant, ...privateKeys })
    // when sync reads the signed-in account
    const error = await signedInSyncContext({ env: { OMO_SERVICE_API_URL: api }, cwd: await temporaryHome(), store }).catch(error => error)
    // then the refusal preserves machine values, not server prose
    expect(error).toBeInstanceOf(ApiRefusal)
    if (!(error instanceof ApiRefusal)) throw error
    expect(error).toMatchObject({ code: code === "unrecognized" ? "unknown" : code, status })
    expect(refusalGuidance(error.code, error.status)).toBe(guidance)
  })

  test.each(["not json", "{}", '{"error":{"code":42}}'])("maps malformed /v1/me refusal by status: %s", async body => {
    // given an unreadable refusal body
    const api = fakeApi(() => new Response(body, { status: 403 }))
    const store = memorySecrets().store(api)
    await store.write({ ...grant, ...privateKeys })
    // when sync reads the account, then the status fallback remains available
    await expect(signedInSyncContext({ env: { OMO_SERVICE_API_URL: api }, cwd: await temporaryHome(), store }))
      .rejects.toMatchObject({ code: "unknown", status: 403 })
  })

  test("recover points at the desktop passkey flow or approval from another device, and exits 2", async () => {
    const result = await runSync(["sync", "recover"], {})
    expect(result.exit).toBe(EXIT_UNSUPPORTED_HERE)
    expect(result.err.join("\n")).toContain("omo sync approve")
  })

  test("enable without a genesis bridge preserves switches and exits 2 on an empty account", async () => {
    const switches: string[] = []
    const result = await runSync(["sync", "enable"], { context: async () => context({ keys: 0, switches }) })
    expect(switches).toEqual([])
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
