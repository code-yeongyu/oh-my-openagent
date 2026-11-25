import { describe, expect, test } from "bun:test"
import { A } from "./fake-keychain.test-support"
import { dedicatedFake, LEASE } from "./dedicated-fake.test-support"
import { StoreSwitchError, storeSwitch } from "./dedicated-switch"

// #13116 design r2 finding 2: enable and disable never leave the sign-in without exactly one authoritative store.
const switcherFor = (fake: ReturnType<typeof dedicatedFake>) =>
  storeSwitch({ access: fake.access, account: A, lease: LEASE, state: fake.state })

describe("turning OmO's own keychain on (#13116)", () => {
  test("#given a sign-in the helper owns in the login keychain #when enabled #then it is copied, read back, activated, and only then removed from the login keychain", async () => {
    const fake = dedicatedFake()
    fake.login.put(A, "dummy-sign-in", "helper")
    expect(await switcherFor(fake).enable()).toEqual({ created: true, moved: "copied", loginLeftover: false })
    expect(fake.state()).toBe("active")
    expect(fake.omo.items.get(A)?.value).toBe("dummy-sign-in")
    expect(fake.login.items.has(A)).toBe(false)
    const order = fake.calls.map((call) => `${call.verb}:${call.store}`)
    expect(order.indexOf("store-activate:omo")).toBeGreaterThan(order.indexOf("read:omo-migrate"))
    expect(order.indexOf("remove:login")).toBeGreaterThan(order.indexOf("store-activate:omo"))
  })

  test("#given a locked login keychain (the headless case) #when enabled #then the store is active and empty and the login keychain is not written", async () => {
    const fake = dedicatedFake({ loginLocked: true })
    expect(await switcherFor(fake).enable()).toEqual({ created: true, moved: "left-locked", loginLeftover: true })
    expect(fake.state()).toBe("active")
    expect(fake.omo.items.size).toBe(0)
    expect(fake.calls.some((call) => call.store === "login" && call.verb !== "read")).toBe(false)
  })

  test("#given an inactive store still holding an old sign-in from an interrupted enable #when enabled with the login keychain locked #then the old sign-in is dropped, never made live (review M1)", async () => {
    const fake = dedicatedFake({ state: "inactive", loginLocked: true })
    fake.omo.put(A, "dummy-logged-out", "helper")
    expect(await switcherFor(fake).enable()).toMatchObject({ moved: "left-locked" })
    expect(fake.state()).toBe("active")
    expect(fake.omo.items.has(A)).toBe(false)
  })

  test("#given a rerun after a crash between activation and cleanup #when enabled again #then OmO's copy is kept and the leftover login copy is removed", async () => {
    const fake = dedicatedFake({ state: "active" })
    fake.omo.put(A, "dummy-rotated", "helper")
    fake.login.put(A, "dummy-stale", "helper")
    expect(await switcherFor(fake).enable()).toEqual({ created: false, moved: "kept-active", loginLeftover: false })
    expect(fake.omo.items.get(A)?.value).toBe("dummy-rotated")
    expect(fake.login.items.has(A)).toBe(false)
  })
})

describe("turning OmO's own keychain off (#13116)", () => {
  test("#given an active store with a sign-in #when disabled #then it moves back to the login keychain and the store is erased", async () => {
    const fake = dedicatedFake({ state: "active" })
    fake.omo.put(A, "dummy-sign-in", "helper")
    expect(await switcherFor(fake).disable(false)).toEqual({ moved: "copied", erased: true })
    expect(fake.login.items.get(A)?.value).toBe("dummy-sign-in")
    expect(fake.state()).toBe("absent")
  })

  test("#given a locked login keychain #when disabled #then it refuses and changes nothing", async () => {
    const fake = dedicatedFake({ state: "active", loginLocked: true })
    fake.omo.put(A, "dummy-sign-in", "helper")
    await expect(switcherFor(fake).disable(false)).rejects.toThrow(/login keychain is locked/)
    expect(fake.state()).toBe("active")
    expect(fake.omo.items.get(A)?.value).toBe("dummy-sign-in")
    expect(fake.calls.some((call) => call.verb === "store-deactivate")).toBe(false)
  })

  test.each([false, true])(
    "#given an inactive store holding a leftover copy (discard %p) #when disabled #then the newer login sign-in is kept and the leftover is dropped",
    async (discard) => {
      const fake = dedicatedFake({ state: "inactive" })
      fake.omo.put(A, "dummy-stale", "helper")
      fake.login.put(A, "dummy-rotated", "helper")
      expect(await switcherFor(fake).disable(discard)).toEqual({ moved: "none", erased: true })
      expect(fake.login.items.get(A)?.value).toBe("dummy-rotated")
      expect(fake.state()).toBe("absent")
      expect(fake.calls.some((call) => call.store === "login" && call.verb === "write")).toBe(false)
    },
  )

  test("#given an inactive store whose keychain file is gone (a crash inside an erase) #when disabled #then the leftover folder is erased", async () => {
    const fake = dedicatedFake({ state: "inactive", keychainGone: true })
    fake.login.put(A, "dummy-sign-in", "helper")
    expect(await switcherFor(fake).disable(false)).toEqual({ moved: "none", erased: true })
    expect(fake.state()).toBe("absent")
    expect(fake.login.items.get(A)?.value).toBe("dummy-sign-in")
  })

  test("#given an active store the helper refuses (damaged) #when disabled #then it points at --discard; #when --discard #then the store is turned off and left in place (review L1)", async () => {
    const fake = dedicatedFake({ state: "active", damaged: true })
    await expect(switcherFor(fake).disable(false)).rejects.toThrow(/--discard/)
    expect(fake.state()).toBe("active")
    expect(await switcherFor(fake).disable(true)).toEqual({ moved: "none", erased: false, damagedLeftInPlace: true })
    expect(fake.state()).toBe("inactive")
  })

  test("#given --discard #when a sign-in remains #then it refuses; #when signed out #then the store is erased", async () => {
    const fake = dedicatedFake({ state: "active" })
    fake.omo.put(A, "dummy-sign-in", "helper")
    await expect(switcherFor(fake).disable(true)).rejects.toBeInstanceOf(StoreSwitchError)
    expect(fake.state()).toBe("active")
    fake.omo.items.delete(A)
    expect(await switcherFor(fake).disable(true)).toEqual({ moved: "none", erased: true })
    expect(fake.state()).toBe("absent")
  })
})
