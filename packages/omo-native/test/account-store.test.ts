import { describe, expect, onTestFinished, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { dedicatedFake } from "../../omo-opencode/src/cli/service-auth/keychain-helper/dedicated-fake.test-support"
import { A, API } from "../../omo-opencode/src/cli/service-auth/keychain-helper/fake-keychain.test-support"
import { ACCOUNT_EXIT } from "../account-show"
import { type AccountStoreDependencies, runAccountStore } from "../account-store"

async function store(args: string[], fake = dedicatedFake(), overrides: Partial<AccountStoreDependencies> = {}) {
  const home = await mkdtemp(join(tmpdir(), "omo-account-store-"))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const output: string[] = []
  const errors: string[] = []
  const code = await runAccountStore(
    {
      api: API,
      platform: "darwin",
      state: fake.state,
      access: async () => fake.access,
      desktopInstalled: () => false,
      home,
      output: (line) => output.push(line),
      error: (line) => errors.push(line),
      ...overrides,
    },
    args,
  )
  return { code, reply: JSON.parse(output.at(-1) ?? "null"), errors, fake }
}

// The `omo account store` machine interface (#13116): one JSON line, exit codes from ACCOUNT_EXIT, notes on stderr.
describe("omo account store", () => {
  test("#given an unknown form #when run #then usage and exit 2, and nothing is touched", async () => {
    const result = await store(["enable", "--force"])
    expect(result.code).toBe(ACCOUNT_EXIT.invalid)
    expect(result.fake.calls).toEqual([])
  })

  test("#given a Mac #when enable runs #then the store is active, the trade-off is stated, and status reports it", async () => {
    const fake = dedicatedFake()
    fake.login.put(A, "dummy-sign-in", "helper")
    const enabled = await store(["enable"], fake, { desktopInstalled: () => true })
    expect(enabled.code).toBe(ACCOUNT_EXIT.ok)
    expect(enabled.reply).toEqual({ store: "omo", created: true, moved: "copied", loginLeftover: false })
    expect(enabled.errors.some((line) => line.includes("FileVault"))).toBe(true)
    expect(enabled.errors.some((line) => line.includes("desktop app"))).toBe(true)
    expect((await store(["status"], fake)).reply).toMatchObject({ store: "omo", state: "active" })
  })

  test("#given a locked login keychain #when disable runs #then exit 1 with the store still active", async () => {
    const fake = dedicatedFake({ state: "active", loginLocked: true })
    fake.omo.put(A, "dummy-sign-in", "helper")
    const result = await store(["disable"], fake)
    expect(result.code).toBe(ACCOUNT_EXIT.failed)
    expect(result.reply).toEqual({ error: "store-switch", store: "omo" })
    expect(fake.state()).toBe("active")
  })

  test("#given Linux #when status runs #then the login store; #when enable runs #then refused without a helper call", async () => {
    const fake = dedicatedFake()
    expect((await store(["status"], fake, { platform: "linux" })).reply).toMatchObject({
      store: "login",
      state: "absent",
    })
    expect((await store(["enable"], fake, { platform: "linux" })).code).toBe(ACCOUNT_EXIT.invalid)
    expect(fake.calls).toEqual([])
  })

  test("#given no verified helper #when enable runs #then exit 9 and no store is created", async () => {
    const result = await store(["enable"], dedicatedFake(), { access: async () => ({ kind: "missing" }) })
    expect(result.code).toBe(ACCOUNT_EXIT.storeUnavailable)
    expect(result.fake.state()).toBe("absent")
  })
})
