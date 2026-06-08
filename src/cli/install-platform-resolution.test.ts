/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { resolveCleanupPlatform, resolveInstallArgs } from "./cli-program"

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

  test("preserves explicit Codex autonomous install flag", () => {
    // given
    const invocationName = "omo"

    // when
    const args = resolveInstallArgs({ tui: true, platform: "codex", codexAutonomous: true }, invocationName)

    // then
    expect(args.codexAutonomous).toBe(true)
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

  test("defaults lazycodex install to codex platform", () => {
    // given
    const invocationName = "lazycodex"

    // when
    const args = resolveInstallArgs({ tui: true }, invocationName)

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

  test("defines Commander choices so invalid --platform values are rejected", async () => {
    // given
    const cliProgramSource = await Bun.file(new URL("./cli-program.ts", import.meta.url)).text()

    // when
    const installBlock = cliProgramSource.match(/program\s*\n\s*\.command\("install"\)([\s\S]*?)\.action\(/)

    // then
    expect(installBlock).not.toBeNull()
    expect(installBlock?.[1]).toContain('new Option("--platform <platform>"')
    expect(installBlock?.[1]).toContain('.choices(["opencode", "codex", "both"])')
    expect(installBlock?.[1]).toContain("--codex-autonomous")
    expect(installBlock?.[1]).toContain("--no-codex-autonomous")
  })

  test("defines root --platform so npx can pass it before install", async () => {
    // given
    const cliProgramSource = await Bun.file(new URL("./cli-program.ts", import.meta.url)).text()

    // when
    const rootBlock = cliProgramSource.match(/program\s*\n\s*\.name\("oh-my-opencode"\)([\s\S]*?)\.enablePositionalOptions\(\)/)

    // then
    expect(rootBlock).not.toBeNull()
    expect(rootBlock?.[1]).toContain('new Option("--platform <platform>"')
    expect(rootBlock?.[1]).toContain('.choices(["opencode", "codex", "both"])')
    expect(rootBlock?.[1]).toContain(".hideHelp()")
  })
})

describe("cleanup platform resolution", () => {
  test("defaults lazycodex cleanup to codex platform", () => {
    // given
    const invocationName = "lazycodex-ai"

    // when
    const platform = resolveCleanupPlatform({}, invocationName)

    // then
    expect(platform).toBe("codex")
  })

  test("leaves omo cleanup without --platform unresolved", () => {
    // given
    const invocationName = "omo"

    // when
    const platform = resolveCleanupPlatform({}, invocationName)

    // then
    expect(platform).toBeUndefined()
  })
})
