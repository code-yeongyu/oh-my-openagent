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

describe("OMO_EDITION doctor routing", () => {
  const originalEdition = process.env.OMO_EDITION

  const withEdition = (edition: string | undefined, run: () => void) => {
    if (edition === undefined) {
      delete process.env.OMO_EDITION
    } else {
      process.env.OMO_EDITION = edition
    }
    try {
      run()
    } finally {
      if (originalEdition === undefined) {
        delete process.env.OMO_EDITION
      } else {
        process.env.OMO_EDITION = originalEdition
      }
    }
  }

  test("#given OMO_EDITION=codex #when resolving a non-codex invocation name #then selects Codex diagnostics", () => {
    withEdition("codex", () => {
      // when
      const target = resolveDoctorTarget("omo-agent-toolkit")

      // then
      expect(target).toBe("codex")
    })
  })

  test("#given OMO_EDITION=codex #when resolving a lazycodex invocation #then the env check wins before the name checks", () => {
    withEdition("codex", () => {
      // when
      const target = resolveDoctorTarget("lazycodex")

      // then
      expect(target).toBe("codex")
    })
  })

  test("#given OMO_EDITION=codex and an explicit opencode platform #when resolving doctor target #then explicit platform wins", () => {
    withEdition("codex", () => {
      // when
      const target = resolveDoctorTarget("omo-agent-toolkit", "opencode")

      // then
      expect(target).toBe("opencode")
    })
  })

  test("#given a non-codex OMO_EDITION #when resolving doctor target #then name-based routing is unchanged", () => {
    withEdition("opencode", () => {
      // when / then
      expect(resolveDoctorTarget("omo-agent-toolkit")).toBe("opencode")
      expect(resolveDoctorTarget("lazycodex-ai")).toBe("codex")
    })
  })

  test("#given unset OMO_EDITION #when resolving doctor target #then today's name-based routing is kept exactly", () => {
    withEdition(undefined, () => {
      // when / then
      expect(resolveDoctorTarget("omo-agent-toolkit")).toBe("opencode")
      expect(resolveDoctorTarget("oh-my-opencode")).toBe("opencode")
      expect(resolveDoctorTarget("lazycodex")).toBe("codex")
      expect(resolveDoctorTarget("lazycodex-ai")).toBe("codex")
    })
  })
})
