import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOnboardingHarness } from "./test-harness"
import { claimOnboarding, isOnboardingComplete, releaseOnboarding } from "./state"
import { createOnboardingComponent } from "./component"

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
    const component = createOnboardingComponent({
      claimOnboarding: () => { claims += 1; return claimOnboarding(dir) },
      isOnboardingComplete: () => isOnboardingComplete(dir),
      releaseOnboarding: () => { releases += 1; releaseOnboarding(dir) },
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
    const real = await h.prompt()
    expect(real.filter(Boolean)).toHaveLength(1)
    expect(preview).toEqual(real)
    expect(isOnboardingComplete(dir)).toBe(true)
    expect(await h.prompt()).toEqual([undefined])
  })
}
