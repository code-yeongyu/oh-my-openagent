/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { resolveInstallArgs } from "./cli-program"
import type { InstallPlatform } from "./types"

describe("install platform resolution", () => {
  test("leaves omo install without --platform unresolved for config defaults", () => {
    // given
    const invocationName = "omo"

    // when
    const args = resolveInstallArgs({ tui: true }, invocationName)

    // then
    expect(args.platform).toBeUndefined()
  })

  test("resolves explicit --platform=codex", () => {
    // given
    const invocationName = "omo"

    // when
    const args = resolveInstallArgs({ tui: true, platform: "codex" }, invocationName)

    // then
    expect(args.platform).toBe("codex")
  })

  test("resolves explicit --platform=both", () => {
    // given
    const invocationName = "omo"

    // when
    const args = resolveInstallArgs({ tui: true, platform: "both" }, invocationName)

    // then
    expect(args.platform).toBe("both")
  })

  test("resolves explicit --platform=opencode", () => {
    // given
    const invocationName = "omo"

    // when
    const args = resolveInstallArgs({ tui: true, platform: "opencode" }, invocationName)

    // then
    expect(args.platform).toBe("opencode")
  })

  test("leaves lazycodex install unresolved when lazycodex publishing is disabled", () => {
    // given
    const invocationName = "lazycodex"

    // when
    const args = resolveInstallArgs({ tui: true }, invocationName)

    // then
    expect(args.platform).toBeUndefined()
  })

  test("defaults lazycodex install to codex platform when lazycodex publishing is enabled", () => {
    // given
    const invocationName = "lazycodex"

    // when
    const args = resolveInstallArgs({ tui: true }, invocationName, { OMO_PUBLISH_LAZYCODEX: "true" })

    // then
    expect(args.platform).toBe("codex")
  })

  test("lets lazycodex install explicitly override to both", () => {
    // given
    const invocationName = "lazycodex"

    // when
    const args = resolveInstallArgs({ tui: true, platform: "both" }, invocationName)

    // then
    expect(args.platform).toBe("both")
  })

  test("lets lazycodex install explicitly override to opencode", () => {
    // given
    const invocationName = "lazycodex"

    // when
    const args = resolveInstallArgs({ tui: true, platform: "opencode" }, invocationName)

    // then
    expect(args.platform).toBe("opencode")
  })

  test("resolves explicit --platform=claudecode", () => {
    // given
    const invocationName = "omo"

    // when
    const args = resolveInstallArgs({ tui: true, platform: "claudecode" }, invocationName)

    // then
    expect(args.platform).toBe("claudecode")
  })

  test("normalizes --platform=cc to claudecode", () => {
    // given
    const invocationName = "omo"

    // when
    const args = resolveInstallArgs(
      { tui: true, platform: "cc" as InstallPlatform },
      invocationName,
    )

    // then
    expect(args.platform).toBe("claudecode")
  })

  test("defaults lazyclaudecode install to claudecode platform", () => {
    // given
    const invocationName = "lazyclaudecode"

    // when
    const args = resolveInstallArgs({ tui: true }, invocationName)

    // then
    expect(args.platform).toBe("claudecode")
  })

  test("lets lazyclaudecode install explicitly override to opencode", () => {
    // given
    const invocationName = "lazyclaudecode"

    // when
    const args = resolveInstallArgs({ tui: true, platform: "opencode" }, invocationName)

    // then
    expect(args.platform).toBe("opencode")
  })

  test("defines Commander choices so invalid --platform values are rejected", async () => {
    // given
    const cliProgramSource = await Bun.file(new URL("./cli-program.ts", import.meta.url)).text()

    // when
    const installBlock = cliProgramSource.match(/program\s*\n\s*\.command\("install"\)([\s\S]*?)\.action\(/)

    // then
    expect(installBlock).not.toBeNull()
    expect(installBlock?.[1]).toContain('new Option("--platform <platform>"')
    expect(installBlock?.[1]).toContain('.choices(["opencode", "codex", "claudecode", "cc", "both"])')
  })
})
