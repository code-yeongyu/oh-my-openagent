import { describe, expect, test } from "bun:test"
import { resolveDoctorTarget } from "./framework/doctor-target"

describe("resolveDoctorTarget", () => {
  test("#given lazycodex invocation #when resolving doctor target #then selects Codex diagnostics", () => {
    // given
    const invocationName = "lazycodex"

    // when
    const target = resolveDoctorTarget(invocationName)

    // then
    expect(target).toBe("codex")
  })

  test("#given lazycodex-ai invocation #when resolving doctor target #then selects Codex diagnostics", () => {
    // given
    const invocationName = "lazycodex-ai"

    // when
    const target = resolveDoctorTarget(invocationName)

    // then
    expect(target).toBe("codex")
  })

  test("#given opencode invocation #when resolving doctor target #then keeps OpenCode diagnostics", () => {
    // given
    const invocationName = "oh-my-opencode"

    // when
    const target = resolveDoctorTarget(invocationName)

    // then
    expect(target).toBe("opencode")
  })

  test("#given explicit codex platform #when resolving doctor target #then selects Codex diagnostics", () => {
    // given / when
    const target = resolveDoctorTarget("omo", "codex")

    // then
    expect(target).toBe("codex")
  })

  test("#given explicit opencode platform from lazycodex invocation #when resolving doctor target #then explicit platform wins", () => {
    // given / when
    const target = resolveDoctorTarget("lazycodex-ai", "opencode")

    // then
    expect(target).toBe("opencode")
  })
})
