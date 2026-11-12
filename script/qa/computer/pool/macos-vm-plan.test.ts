import { describe, expect, test } from "bun:test"
import { guestName, isPoolGuest, planGuest, type PoolHost, RUNNER_LABEL } from "./macos-vm-plan.ts"

const host: PoolHost = {
  platform: "darwin",
  arch: "arm64",
  hypervisor: "/opt/hv/bin/vmctl",
  baseImages: { "15": "base-macos15", "26": "base-macos26" },
  consoleUser: null,
  runnerUser: "qa-pool",
}

describe("guest plan", () => {
  test("a ready Apple-silicon host plans a labelled clone of the recorded base image", () => {
    expect(planGuest(host, "26", "43209825336")).toEqual({
      kind: "plan",
      major: "26",
      baseImage: "base-macos26",
      guestName: "omo-cu-macos26-43209825336",
      labels: [RUNNER_LABEL, "macos-26"],
    })
  })

  test("a missing base image is refused with the hands-on step named, never improvised", () => {
    const plan = planGuest({ ...host, baseImages: { "26": "base-macos26" } }, "15", "1")
    expect(plan).toEqual({
      kind: "refused",
      reason: "no recorded base image for macOS 15 (its first setup is a hands-on step)",
    })
  })

  test("a host whose console session belongs to the pool user is refused: no guest in a person's session", () => {
    const plan = planGuest({ ...host, consoleUser: "qa-pool" }, "15", "1")
    expect(plan.kind).toBe("refused")
  })

  test("a host where any person is signed in at the console is refused, not only the pool user", () => {
    const plan = planGuest({ ...host, consoleUser: "someone" }, "15", "1")
    expect(plan).toEqual({
      kind: "refused",
      reason: "someone is signed in at the console; guests run only on a host nobody is using",
    })
  })

  test("Linux, an Intel Mac and a host without a hypervisor are refused", () => {
    expect(planGuest({ ...host, platform: "linux" }, "15", "1").kind).toBe("refused")
    expect(planGuest({ ...host, arch: "x64" }, "15", "1").kind).toBe("refused")
    expect(planGuest({ ...host, hypervisor: null }, "15", "1").kind).toBe("refused")
  })
})

describe("guest ownership", () => {
  test("only names this pool minted count as its guests, so teardown never deletes a foreign VM", () => {
    expect(isPoolGuest(guestName("15", "77"))).toBe(true)
    expect(isPoolGuest("base-macos15")).toBe(false)
    expect(isPoolGuest("omo-cu-../../x")).toBe(false)
  })
})
