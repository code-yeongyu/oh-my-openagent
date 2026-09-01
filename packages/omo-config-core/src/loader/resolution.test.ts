import { describe, expect, test } from "bun:test"
import { resolveOmoConfigView, resolveOmoProfileName } from "../index"

describe("resolveOmoProfileName", () => {
  test("#given an explicit profile and every environment source #when resolving activation #then the explicit option wins", () => {
    // given
    const options = {
      env: {
        OCX_PROFILE: "ocx",
        OMO_PROFILE: "omo",
        OPENCODE_CONFIG_DIR: "/does-not-exist/profiles/directory",
      },
      profile: "explicit",
    }

    // when
    const profile = resolveOmoProfileName(options)

    // then
    expect(profile).toBe("explicit")
  })

  test("#given OMO_PROFILE and lower-precedence environment sources #when resolving activation #then OMO_PROFILE wins", () => {
    // given
    const options = {
      env: {
        OCX_PROFILE: "ocx",
        OMO_PROFILE: "omo",
        OPENCODE_CONFIG_DIR: "/does-not-exist/profiles/directory",
      },
    }

    // when
    const profile = resolveOmoProfileName(options)

    // then
    expect(profile).toBe("omo")
  })

  test("#given OCX_PROFILE and OPENCODE_CONFIG_DIR #when resolving activation #then OCX_PROFILE wins", () => {
    // given
    const options = {
      env: {
        OCX_PROFILE: "ocx",
        OPENCODE_CONFIG_DIR: "/does-not-exist/profiles/directory",
      },
    }

    // when
    const profile = resolveOmoProfileName(options)

    // then
    expect(profile).toBe("ocx")
  })

  test("#given an OPENCODE_CONFIG_DIR ending in profiles/kimi #when resolving activation #then kimi is derived lexically without filesystem access", () => {
    // given
    const options = {
      env: { OPENCODE_CONFIG_DIR: "/this-path-does-not-exist/profiles/kimi" },
    }

    // when
    const profile = resolveOmoProfileName(options)

    // then
    expect(profile).toBe("kimi")
  })

  test("#given an OPENCODE_CONFIG_DIR without a profiles tail #when resolving activation #then no profile is derived", () => {
    // given
    const options = {
      env: { OPENCODE_CONFIG_DIR: "/this-path-does-not-exist/opencode" },
    }

    // when
    const profile = resolveOmoProfileName(options)

    // then
    expect(profile).toBeUndefined()
  })

  test("#given no profile option or environment source #when resolving activation #then no profile is active", () => {
    // given
    const options = { env: {} }

    // when
    const profile = resolveOmoProfileName(options)

    // then
    expect(profile).toBeUndefined()
  })
})

describe("resolveOmoConfigView", () => {
  test("#given base, harness, profile-base, and profile-harness layers #when resolving a harness profile #then later layers win and control keys are removed", () => {
    // given
    const config = {
      settings: {
        base: "base",
        winner: "base",
      },
      "[senpi]": {
        settings: {
          harness: "harness",
          winner: "harness",
        },
      },
      profiles: {
        opus: {
          settings: {
            profileBase: "profile-base",
            winner: "profile-base",
          },
          "[senpi]": {
            settings: {
              profileHarness: "profile-harness",
              winner: "profile-harness",
            },
          },
        },
      },
    }

    // when
    const result = resolveOmoConfigView({ config, harness: "senpi", profile: "opus" })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.profile).toBe("opus")
    expect(result.config).toEqual({
      settings: {
        base: "base",
        harness: "harness",
        profileBase: "profile-base",
        profileHarness: "profile-harness",
        winner: "profile-harness",
      },
    })
    expect("[senpi]" in result.config).toBe(false)
    expect("profiles" in result.config).toBe(false)
  })

  test("#given an absent activated profile #when resolving a harness view #then a diagnostic is emitted and the no-profile view is used", () => {
    // given
    const config = {
      settings: { base: "base" },
      "[senpi]": { settings: { harness: "harness" } },
      profiles: {
        opus: { settings: { profile: "opus" } },
      },
    }

    // when
    const result = resolveOmoConfigView({ config, harness: "senpi", profile: "ghost" })

    // then
    expect(result.profile).toBeUndefined()
    expect(result.config).toEqual({ settings: { base: "base", harness: "harness" } })
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatchObject({ kind: "profile", path: "profiles.ghost" })
  })
})
