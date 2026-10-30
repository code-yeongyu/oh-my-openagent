import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOnboardingHarness } from "./test-harness"
import { claimOnboarding, isOnboardingComplete, releaseOnboarding } from "./state"
import { claimOnboardingOwned } from "./claim-owner"
import { claimableWithOwner, createOnboardingComponent } from "./component"

const dirs: string[] = []
afterEach(() => {
  Reflect.deleteProperty(globalThis, Symbol.for("omo.onboard"))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

for (const forced of [false, true]) {
  test(`#given ${forced ? "forced" : "first-run"} onboarding #when previewed #then its addition matches the real turn without consuming state`, async () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), "onboard-preview-"))
    dirs.push(dir)
    let claims = 0
    let releases = 0
    let historyReads = 0
    const component = createOnboardingComponent({
      claimOnboarding: () => { claims += 1; return claimOnboarding(dir) },
      isOnboardingComplete: () => isOnboardingComplete(dir),
      releaseOnboarding: () => { releases += 1; releaseOnboarding(dir) },
      scan: async () => ({ scanId: "preview", digests: [], projectRoots: new Set<string>(), context: "Scan rows: 2 sign-ins.", inventory: "2 sign-ins" }),
      sessionHistory: async () => { historyReads += 1; return undefined },
    })
    const h = createOnboardingHarness(dir, "preview", "tui", component)
    if (forced) claimOnboarding(dir)
    h.pi.setFlag("onboard", forced)
    if (!forced) await h.start()
    const files = readdirSync(dir).map((name) => [name, readFileSync(join(dir, name), "utf8")])
    const widgets = new Map(h.widgets)
    const latch = Reflect.get(globalThis, Symbol.for("omo.onboard"))
    // when
    const preview = await h.prompt({ preview: true })
    // then
    expect(readdirSync(dir).map((name) => [name, readFileSync(join(dir, name), "utf8")])).toEqual(files)
    expect(claims).toBe(0)
    expect(releases).toBe(0)
    expect(isOnboardingComplete(dir)).toBe(forced)
    expect(Reflect.get(globalThis, Symbol.for("omo.onboard"))).toBe(latch)
    expect(h.widgets).toEqual(widgets)
    expect(h.pi.messages).toEqual([])
    expect(h.branch).toEqual([])
    expect(historyReads).toBe(0)
    const real = await h.prompt()
    expect(real.filter(Boolean)).toHaveLength(1)
    expect(JSON.stringify(real)).toContain("2 sign-ins")
    expect(preview).toEqual(real)
    expect(historyReads).toBe(1)
    expect(isOnboardingComplete(dir)).toBe(true)
    expect(await h.prompt()).toEqual([undefined])
  })
}

test("#given a claim whose owner died #when previewed #then it adds what the real turn adds after taking the claim over", async () => {
  // given
  const dir = mkdtempSync(join(tmpdir(), "onboard-preview-stale-"))
  dirs.push(dir)
  const deadOwner = { pid: 2_147_483_000, processStart: null }
  writeFileSync(join(dir, "onboarding-completed"), JSON.stringify({ claimedAt: new Date().toISOString(), version: 2, owner: deadOwner }))
  const claimOwnerSeams = { getPidLiveness: () => "dead" as const }
  let claims = 0
  const component = createOnboardingComponent({
    claimOnboarding: (stateDir, seams) => { claims += 1; return claimOnboardingOwned(stateDir, seams) },
    isOnboardingComplete: () => isOnboardingComplete(dir),
    isOnboardingClaimable: claimableWithOwner,
    releaseOnboarding: () => releaseOnboarding(dir),
    claimOwnerSeams,
    stateDir: dir,
    scan: async () => ({ scanId: "stale", digests: [], projectRoots: new Set<string>(), context: "Scan rows: 1 sign-in.", inventory: "1 sign-in" }),
    sessionHistory: async () => undefined,
  })
  const h = createOnboardingHarness(dir, "stale", "tui", component)
  await h.start()
  const marker = readFileSync(join(dir, "onboarding-completed"), "utf8")
  // when
  const preview = await h.prompt({ preview: true })
  // then
  expect(readFileSync(join(dir, "onboarding-completed"), "utf8")).toBe(marker)
  expect(claims).toBe(0)
  const real = await h.prompt()
  expect(claims).toBe(1)
  expect(JSON.stringify(real)).toContain("1 sign-in")
  expect(preview).toEqual(real)
})
