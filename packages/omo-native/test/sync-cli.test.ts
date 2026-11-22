import { afterEach, describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { join } from "node:path"

import type {
  AccountHttp,
  DeviceSyncOff,
  PairingHttp,
  PendingApproval,
} from "../../memory-core/src/sync/account/index.ts"
import { MEMORY_ROOT_ENV_VAR } from "../../memory-core/src/identity/layout"
import { isDeviceSyncOff } from "../../memory-core/src/sync/account/device-switch.ts"
import { syncPinDir } from "../../memory-core/src/sync/pin-dir"
import { createInMemoryDeviceKeyring } from "../../memory-core/src/sync/keyring-port"
import { Command } from "commander"

import { ApiRefusal, refusalGuidance, SignInError } from "../../omo-opencode/src/cli/service-auth/protocol"
import {
  fakeApi,
  grant,
  memorySecrets,
  privateKeys,
  refusal,
  temporaryHome,
} from "../../omo-opencode/src/cli/service-auth/test-support"
import { withGenesisLock } from "../../memory-core/src/sync/genesis/intent-store"
import { configureSyncCommands, EXIT_UNSUPPORTED_HERE, type SyncCommandDependencies } from "../sync-cli"
import { signedInSyncContext, type SyncContext } from "../sync-context"

const initialExitCode = process.exitCode
afterEach(() => {
  process.exitCode = initialExitCode ?? 0
})

const unused = (): never => {
  throw new Error("not used by this case")
}

async function context(
  overrides: {
    readonly keys?: number
    readonly pending?: PendingApproval[]
    readonly switches?: string[]
    readonly disable?: () => Promise<DeviceSyncOff>
  } = {},
): Promise<SyncContext> {
  const switches = overrides.switches ?? []
  const chain: AccountHttp = {
    listKeys: async () => Array.from({ length: overrides.keys ?? 0 }, unused),
    listEntries: unused,
    listEntriesAfter: unused,
    listRecoveryWraps: unused,
    appendKeys: unused,
    recoveryJoin: unused,
    state: unused,
  }
  const pairing: PairingHttp = {
    setAccountSync: async (enabled) => {
      switches.push(`account ${enabled}`)
    },
    setDeviceSync: async (id, enabled) => {
      switches.push(`device ${id} ${enabled}`)
    },
    disableDeviceSync: async (id) => {
      switches.push(`disable ${id}`)
      return (await overrides.disable?.()) ?? { ok: true }
    },
    listPending: async () => overrides.pending ?? [],
    openPending: unused,
    readPending: unused,
    answerPending: unused,
    revealPending: unused,
  }
  const authority = { signal: new AbortController().signal, admit: <T>(dispatch: () => T): T => dispatch() }
  return {
    account: "acct",
    serviceDeviceId: "dev_svc",
    keyring: createInMemoryDeviceKeyring("p"),
    pinDir: await temporaryHome(),
    chain,
    pairing,
    authority,
  }
}

async function runSync(
  args: string[],
  dependencies: Partial<SyncCommandDependencies>,
): Promise<{ readonly out: string[]; readonly err: string[]; readonly exit: typeof process.exitCode }> {
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
    // Review MEDIUM (#13337): never the real environment or the real /dev/tty.
    env: {},
    terminalAvailable: () => false,
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
    const error = await signedInSyncContext({
      env: { OMO_SERVICE_API_URL: api },
      cwd: await temporaryHome(),
      store,
    }).catch((error) => error)
    // then the refusal preserves machine values, not server prose
    expect(error).toBeInstanceOf(ApiRefusal)
    if (!(error instanceof ApiRefusal)) throw error
    expect(error).toMatchObject({ code: code === "unrecognized" ? "unknown" : code, status })
    expect(refusalGuidance(error.code, error.status)).toBe(guidance)
  })

  test.each(["not json", "{}", '{"error":{"code":42}}'])(
    "maps malformed /v1/me refusal by status: %s",
    async (body) => {
      // given an unreadable refusal body
      const api = fakeApi(() => new Response(body, { status: 403 }))
      const store = memorySecrets().store(api)
      await store.write({ ...grant, ...privateKeys })
      // when sync reads the account, then the status fallback remains available
      await expect(
        signedInSyncContext({ env: { OMO_SERVICE_API_URL: api }, cwd: await temporaryHome(), store }),
      ).rejects.toMatchObject({ code: "unknown", status: 403 })
    },
  )

  test("#given sync on for this device #when omo sync disable runs #then only this device is turned off, on the service and locally, and it says memory stays", async () => {
    const switches: string[] = []
    const signedIn = await context({ switches })
    const result = await runSync(["sync", "disable"], { context: async () => signedIn })
    expect(switches).toEqual(["disable dev_svc"])
    expect(await isDeviceSyncOff(signedIn.pinDir, signedIn.account)).toBe(true)
    expect(result.exit).toBe(0)
    expect(result.err).toEqual([])
    expect(result.out).toEqual([
      "Memory sync is off for this device. Memory on this device stays as it is, and your other devices keep syncing.",
      "Run `omo sync enable` to turn it on again.",
    ])
  })

  test("#given a signed-in device and a service that enforces its confirmation #when omo sync disable runs over HTTP #then the confirmation is asked for this device, its token is spent on the switch and the device is off locally", async () => {
    // given a service that turns a device off only for a request that spends the token it issued for that device
    const requests: string[] = []
    const confirmToken = "c".repeat(43)
    const api = fakeApi(async (request) => {
      const path = new URL(request.url).pathname
      if (path === "/v1/me") return Response.json({ account: { id: "acct_http" } })
      const body = (await request.json()) as Record<string, unknown>
      requests.push(`${request.method} ${path} ${JSON.stringify(body)}`)
      if (path === "/v1/confirm")
        return Response.json({
          ready: true,
          code: null,
          at: "2026-11-17T00:00:00.000Z",
          token: confirmToken,
          expiresAt: "2026-11-17T00:10:00.000Z",
        })
      return path === `/v1/devices/${grant.device.id}/sync` && body["confirmToken"] === confirmToken
        ? new Response(null, { status: 204 })
        : refusal("invalid_request")
    })
    const store = memorySecrets().store(api)
    await store.write({
      ...grant,
      signingPrivateKey: generateKeyPairSync("ed25519")
        .privateKey.export({ format: "der", type: "pkcs8" })
        .toString("base64"),
      sealingPrivateKey: generateKeyPairSync("x25519")
        .privateKey.export({ format: "der", type: "pkcs8" })
        .toString("base64"),
    })
    // The memory root is pinned inside the test's own directory, so the local switch never lands in a real home.
    const memoryRoot = join(await temporaryHome(), "memory")
    // when the real sign-in context and HTTP client run the verb
    const result = await runSync(["sync", "disable"], {
      context: () =>
        signedInSyncContext({
          env: { OMO_SERVICE_API_URL: api, [MEMORY_ROOT_ENV_VAR]: memoryRoot },
          cwd: memoryRoot,
          store,
        }),
    })
    // then only this device was turned off, with the confirmation spent, and it is off locally
    expect(result).toMatchObject({ exit: 0, err: [] })
    expect(requests).toEqual([
      `POST /v1/confirm {"action":"sync.disable_device","target":"${grant.device.id}"}`,
      `PUT /v1/devices/${grant.device.id}/sync {"enabled":false,"confirmToken":"${confirmToken}"}`,
    ])
    expect(await isDeviceSyncOff(syncPinDir(memoryRoot), "acct_http")).toBe(true)
  })

  test("#given a device already off #when omo sync disable runs again #then it answers off again and exits 0", async () => {
    const signedIn = await context()
    await runSync(["sync", "disable"], { context: async () => signedIn })
    const again = await runSync(["sync", "disable"], { context: async () => signedIn })
    expect(again.exit).toBe(0)
    expect(again.out[0]).toContain("Memory sync is off for this device.")
    expect(await isDeviceSyncOff(signedIn.pinDir, signedIn.account)).toBe(true)
  })

  test("#given the service refuses #when omo sync disable runs #then it says so without the service's code, leaves this device on and exits 1", async () => {
    const signedIn = await context({ disable: async () => ({ ok: false, code: "not_found" }) })
    const result = await runSync(["sync", "disable"], { context: async () => signedIn })
    expect(result.exit).toBe(1)
    expect(result.out).toEqual([])
    expect(result.err).toEqual([
      "The service did not turn memory sync off for this device. Run `omo sync disable` again.",
    ])
    expect(await isDeviceSyncOff(signedIn.pinDir, signedIn.account)).toBe(false)
  })

  test("#given a signed-out device #when omo sync disable runs #then it prints the sign-in line and exits 1", async () => {
    const result = await runSync(["sync", "disable"], {
      context: async () => {
        throw new SignInError("Not signed in. Run `omo login` first.")
      },
    })
    expect(result.exit).toBe(1)
    expect(result.err).toEqual(["Not signed in. Run `omo login` first."])
  })

  test("recover without a controlling terminal refuses, points at the desktop passkey flow or approval from another device, and exits 2", async () => {
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

  test("enable while another window holds the recovery setup lock exits 1 with the in-progress line, writing nothing", async () => {
    const switches: string[] = []
    const held = await context({ keys: 0, switches })
    const release = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    const holder = withGenesisLock(held, async () => {
      entered.resolve(undefined)
      await release.promise
    })
    await entered.promise
    let result: Awaited<ReturnType<typeof runSync>>
    try {
      result = await runSync(["sync", "enable"], { context: async () => held })
    } finally {
      release.resolve(undefined)
      await holder
    }
    expect(result.exit).toBe(1)
    expect(result.err.join("\n")).toContain("in the middle of a recovery setup")
    expect(switches).toEqual([])
  })

  test("approve refuses without an interactive terminal, because the person must compare the codes", async () => {
    const result = await runSync(["sync", "approve"], { interactive: false })
    expect(result.exit).toBe(1)
  })

  test("approve with nothing waiting says so; with two waiting it asks which one", async () => {
    expect((await runSync(["sync", "approve"], {})).exit).toBe(1)
    const row = (id: string): PendingApproval => ({
      id,
      account: "acct",
      commitment: "c",
      answer: null,
      reveal: null,
      expires_at: 1,
    })
    const two = await runSync(["sync", "approve"], {
      context: async () => context({ pending: [row("one"), row("two")] }),
    })
    expect(two.exit).toBe(1)
    expect(two.err.join("\n")).toContain("one, two")
  })

  test("a signed-out device is told to sign in, with exit 1", async () => {
    const result = await runSync(["sync", "enable"], {
      context: async () => {
        throw new SignInError("Not signed in. Run omo login first.")
      },
    })
    expect(result).toMatchObject({ exit: 1, err: ["Not signed in. Run omo login first."] })
  })
})
