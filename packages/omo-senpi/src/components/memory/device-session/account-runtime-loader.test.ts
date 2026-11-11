import { describe, expect, test } from "bun:test"

import type { CliDeviceAccount, DeviceAccount, DeviceAccountSource } from "./account-source"
import { SyncSidecarUnavailableError } from "../sync-runner"
import { type DeviceAccountRuntimeModule, selectedDeviceAccountSource } from "./account-runtime-loader"
import type { MemorySyncSelection } from "../desktop-sync/hostSelection"

const account = (accountId: string): CliDeviceAccount => ({
  kind: "cli",
  descriptor: { genesis: "unsupported", rpId: null, userName: null, serviceOrigin: "http://127.0.0.1:9", accountId, serviceDeviceId: "service-device", syncPrincipalId: "principal", publicKeys: { signing: "signing", sealing: "sealing" }, generation: "fixture", incarnation: "cli" },
  signal: new AbortController().signal,
  boundary: async dispatch => dispatch(),
  forOperation: async () => { throw new Error("unused") },
  serviceDeviceId: "service-device",
  isCurrent: async () => true,
  api: "http://127.0.0.1:9",
  accountId,
  keyring: () => Promise.reject(new Error("unused")),
  accessToken: async () => "token",
  signedOut: async () => false,
})

// An undeclared launch (no inherited table in this process) selects the CLI source, so only createCliAccountSource runs.
const cliRuntime = (create: (options: Parameters<DeviceAccountRuntimeModule["selectedAccountSource"]>[1]) => DeviceAccountSource): DeviceAccountRuntimeModule => ({
  selectedAccountSource: (selection, options) => {
    let built: DeviceAccountSource | undefined
    return async () => {
      const selected: MemorySyncSelection = await selection()
      if (selected.kind !== "cli") throw new Error(`expected the CLI selection, got ${selected.kind}`)
      built ??= create(options)
      return built()
    }
  },
  claimInheritedDesktopSync: () => Promise.reject(new Error("an undeclared launch never claims")),
  serveWorkerPort: () => { throw new Error("the main thread spawned no session Worker here") },
  workerMemorySyncSelection: () => Promise.reject(new Error("the main thread reads no Worker port")),
})

const accountIdOf = (resolved: DeviceAccount | null): string | undefined => resolved?.kind === "cli" ? resolved.accountId : undefined

describe("selectedDeviceAccountSource", () => {
  test("#given a lazy account source #when it is built and then resolved twice #then the sidecar loads once, on the first resolve, and each resolve reads the account again", async () => {
    let loads = 0
    const reads: string[] = []
    const received: unknown[] = []
    const runtime = cliRuntime((options) => {
      received.push(options)
      return async () => {
        reads.push("read")
        return reads.length === 1 ? account("acct_1") : null
      }
    })
    const source = selectedDeviceAccountSource({ env: { OMO_SERVICE_API_URL: "http://127.0.0.1:9" } }, async () => {
      loads += 1
      return runtime
    })

    expect(loads).toBe(0)
    const first = await source()
    const second = await source()

    expect(loads).toBe(1)
    expect(received).toEqual([{ env: { OMO_SERVICE_API_URL: "http://127.0.0.1:9" } }])
    expect(accountIdOf(first)).toBe("acct_1")
    expect(second).toBeNull()
    expect(reads).toEqual(["read", "read"])
  })

  test("#given a sidecar that fails to load once #when the source is resolved again #then the load error surfaces and the next resolve retries", async () => {
    let loads = 0
    const source = selectedDeviceAccountSource({ env: {} }, async () => {
      loads += 1
      if (loads === 1) throw new Error("Cannot find module '#omo-device-account-runtime'")
      return cliRuntime(() => async () => account("acct_2"))
    })

    const failure = await source().then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(SyncSidecarUnavailableError)
    expect(String(failure)).toContain("Cannot find module '#omo-device-account-runtime'")
    const [first, second] = await Promise.all([source(), source()])

    expect(accountIdOf(first)).toBe("acct_2")
    expect(accountIdOf(second)).toBe("acct_2")
    expect(loads).toBe(2)
  })

  test("#given omo.js re-evaluated by an extension hot reload #when the fresh module instance selects the account source #then it reuses the process's memory-sync provider instead of providing the name again", async () => {
    type Loader = typeof import("./account-runtime-loader")
    // A hot reload loads omo.js as a new module instance in the same process; senpi's worker-data registry survives it.
    const generation = (name: string): Promise<Loader> => import(`./account-runtime-loader?generation=${name}`)
    const before = await generation("before-reload")
    const after = await generation("after-reload")
    const runtime = async (): Promise<DeviceAccountRuntimeModule> => cliRuntime(() => async () => account("acct_3"))

    before.selectedDeviceAccountSource({ env: {} }, runtime)
    const reloaded = after.selectedDeviceAccountSource({ env: {} }, runtime)
    expect(accountIdOf(await reloaded())).toBe("acct_3")
  })

  test("#given a provider registered by an earlier omo build that had no process guard #when this build selects the account source #then the bootstrap failure names the in-place update and the restart remedy", async () => {
    const guard = Symbol.for("omo.memory-sync.worker-data-provided.v1")
    const provided = globalThis as typeof globalThis & { [key: symbol]: unknown }
    // An earlier build provided the name but never set the guard: the registry holds the name, the guard is absent.
    const fresh = await import("./account-runtime-loader?generation=older-build-registered")
    fresh.selectedDeviceAccountSource({ env: {} }, async () => cliRuntime(() => async () => account("acct_4")))
    const kept = provided[guard]
    delete provided[guard]
    try {
      const current = await import("./account-runtime-loader?generation=after-older-build")
      expect(() => current.selectedDeviceAccountSource({ env: {} }, async () => cliRuntime(() => async () => account("acct_4")))).toThrow(
        /already provided.*restart the session/s,
      )
    } finally {
      provided[guard] = kept
    }
  })
})
