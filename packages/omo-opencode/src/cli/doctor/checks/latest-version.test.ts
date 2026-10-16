import { describe, expect, it } from "bun:test"

import type { NpmDistTags } from "../../config-manager/npm-dist-tags"
import type { CodexDoctorSummary, SystemInfo } from "../framework/types"
import { gatherEditionDistTags, resolveLatestVersion } from "./latest-version"

function createSystemInfo(pluginVersion: string | null): SystemInfo {
  return {
    opencodeVersion: "1.0.200",
    opencodePath: "/usr/local/bin/opencode",
    pluginVersion,
    loadedVersion: pluginVersion,
    bunVersion: "1.2.0",
    configPath: "/tmp/opencode.json",
    configValid: true,
    isLocalDev: false,
  }
}

function createCodexSummary(overrides: Partial<CodexDoctorSummary> = {}): CodexDoctorSummary {
  return {
    codexPath: "/usr/local/bin/codex",
    codexSource: "cli",
    codexAppId: null,
    marketplaceName: "sisyphuslabs",
    pluginName: "omo",
    pluginVersion: "5.0.0-beta.51",
    pluginVersionStamped: true,
    installerVersion: "5.0.0-beta.51",
    packageName: "lazycodex-ai",
    packageVersion: "5.0.0-beta.51",
    pluginRoot: "/tmp/omo",
    configPath: "/tmp/config.toml",
    config: {
      exists: true,
      marketplaceConfigured: true,
      pluginEnabled: true,
      pluginsFeatureEnabled: true,
      pluginHooksFeatureEnabled: true,
      companionPluginEnabled: false,
      companionLifecycleHookStateEvents: [],
    },
    linkedBins: ["omo"],
    agents: ["plan"],
    ...overrides,
  }
}

describe("gatherEditionDistTags", () => {
  it("fetches the oh-my-openagent dist-tags for the OpenCode edition", async () => {
    //#given
    const requested: string[] = []
    const tags: NpmDistTags = { latest: "4.19.4", beta: "5.0.0-beta.51" }

    //#when
    const result = await gatherEditionDistTags("opencode", async (packageName) => {
      requested.push(packageName)
      return tags
    })

    //#then
    expect(requested).toEqual(["oh-my-openagent"])
    expect(result).toEqual(tags)
  })

  it("fetches the lazycodex-ai dist-tags for the Codex edition", async () => {
    //#given
    const requested: string[] = []

    //#when
    await gatherEditionDistTags("codex", async (packageName) => {
      requested.push(packageName)
      return { latest: "4.19.4" }
    })

    //#then
    expect(requested).toEqual(["lazycodex-ai"])
  })
})

describe("resolveLatestVersion", () => {
  it("returns the beta tag when the installed OpenCode plugin is on the beta channel", () => {
    //#given
    const distTags: NpmDistTags = { latest: "4.19.4", beta: "5.0.0-beta.52" }

    //#when
    const latest = resolveLatestVersion({
      target: "opencode",
      systemInfo: createSystemInfo("5.0.0-beta.51"),
      codex: undefined,
      distTags,
    })

    //#then
    expect(latest).toBe("5.0.0-beta.52")
  })

  it("returns the latest tag when the installed OpenCode plugin is a stable release", () => {
    //#given
    const distTags: NpmDistTags = { latest: "4.19.4", beta: "5.0.0-beta.52" }

    //#when
    const latest = resolveLatestVersion({
      target: "opencode",
      systemInfo: createSystemInfo("4.19.0"),
      codex: undefined,
      distTags,
    })

    //#then
    expect(latest).toBe("4.19.4")
  })

  it("falls back to the latest tag when the installed channel has no dist-tag", () => {
    //#given
    const distTags: NpmDistTags = { latest: "4.19.4" }

    //#when
    const latest = resolveLatestVersion({
      target: "opencode",
      systemInfo: createSystemInfo("5.0.0-rc.1"),
      codex: undefined,
      distTags,
    })

    //#then
    expect(latest).toBe("4.19.4")
  })

  it("returns null when the registry lookup failed", () => {
    //#when
    const latest = resolveLatestVersion({
      target: "opencode",
      systemInfo: createSystemInfo("5.0.0-beta.51"),
      codex: undefined,
      distTags: null,
    })

    //#then
    expect(latest).toBeNull()
  })

  it("selects the Codex channel from the installed lazycodex-ai package version", () => {
    //#given
    const distTags: NpmDistTags = { latest: "4.19.4", beta: "5.0.0-beta.52" }

    //#when
    const latest = resolveLatestVersion({
      target: "codex",
      systemInfo: createSystemInfo("4.19.0"),
      codex: createCodexSummary({ packageVersion: "5.0.0-beta.51" }),
      distTags,
    })

    //#then
    expect(latest).toBe("5.0.0-beta.52")
  })

  it("falls back to the Codex installer version when no distribution snapshot exists", () => {
    //#given
    const distTags: NpmDistTags = { latest: "4.19.4", beta: "5.0.0-beta.52" }

    //#when
    const latest = resolveLatestVersion({
      target: "codex",
      systemInfo: createSystemInfo("5.0.0-beta.51"),
      codex: createCodexSummary({ packageVersion: null, installerVersion: "4.19.0" }),
      distTags,
    })

    //#then
    expect(latest).toBe("4.19.4")
  })
})
