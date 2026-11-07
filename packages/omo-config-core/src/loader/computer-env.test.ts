import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig, resolveOmoConfigView } from "../index"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(user: unknown, project: unknown) {
  const home = mkdtempSync(join(tmpdir(), "omo-computer-env-"))
  roots.push(home)
  const cwd = join(home, "project")
  for (const [directory, config] of [[home, user], [cwd, project]] as const) {
    mkdirSync(join(directory, ".omo"), { recursive: true })
    writeFileSync(join(directory, ".omo", "omo.jsonc"), JSON.stringify(config))
  }
  return { cwd, env: { HOME: home }, harness: "native" as const, profile: "desktop" }
}

describe("computer.env source policy", () => {
  test.each([false, true])(
    "#given project env at every scope and user env present=%s #when loading #then only user values survive in resolved and reusable layers",
    (hasUserEnv) => {
      // given
      const user = hasUserEnv ? {
        computer: { env: { DISPLAY: ":1", XAUTHORITY: "${HOME}/literal" } },
        "[native]": { computer: { env: { DISPLAY: ":2", XDG_RUNTIME_DIR: "/run/user/1000" } } },
        profiles: {
          desktop: {
            computer: { env: { DISPLAY: ":3", WAYLAND_DISPLAY: "wayland-user" } },
            "[native]": { computer: { env: { DISPLAY: ":4", WAYLAND_DISPLAY: null } } },
          },
        },
      } : {}
      const projectBlock = { computer: { enabled: false, env: { DISPLAY: ":99", XAUTHORITY: null } } }
      const options = fixture(user, {
        ...projectBlock,
        "[native]": projectBlock,
        profiles: { desktop: { ...projectBlock, "[native]": projectBlock } },
      })

      // when
      const loaded = loadOmoConfig(options)
      const project = loaded.layers.find((layer) => layer.source.scope === "project")
      const reusable = resolveOmoConfigView({
        config: project?.config ?? {}, harness: "native", profile: "desktop",
      })

      // then
      expect(loaded.config.computer?.env).toEqual(hasUserEnv ? {
        DISPLAY: ":4", XAUTHORITY: "${HOME}/literal", XDG_RUNTIME_DIR: "/run/user/1000", WAYLAND_DISPLAY: null,
      } : undefined)
      expect(loaded.config.computer?.enabled).toBe(false)
      expect(reusable.config.computer).toEqual({ enabled: false })
      expect(loaded.diagnostics.flatMap((entry) => entry.issuePaths ?? [])).toEqual([
        "computer.env", "[native].computer.env",
        "profiles.desktop.computer.env", "profiles.desktop.[native].computer.env",
      ])
    },
  )

  test.each(["[native]", "[senpi]", "[opencode]", "[codex]"])(
    "#given project env in %s #when loading raw layers #then it cannot re-enter through a harness consumer",
    (harness) => {
      // given
      const options = fixture({}, { [harness]: { computer: { env: { DISPLAY: ":99" } } } })
      // when
      const loaded = loadOmoConfig(options)
      // then
      expect(JSON.stringify(loaded.layers)).not.toContain('":99"')
    },
  )

  test("#given forbidden variables beside valid user overrides #when loading #then only forbidden entries are dropped and diagnosed without their values", () => {
    // given
    const options = fixture({
      computer: { env: { DISPLAY: ":98", LD_PRELOAD: "/private/secret.so" } },
      "[native]": { computer: { env: { XAUTHORITY: "${HOME}/literal", PATH: "/private/bin" } } },
      profiles: { desktop: {
        computer: { env: { XDG_RUNTIME_DIR: "/run/user/1000", DBUS_SESSION_BUS_ADDRESS: "private-bus" } },
        "[native]": { computer: { env: { WAYLAND_DISPLAY: null, OTHER: null } } },
      } },
    }, {})
    // when
    const loaded = loadOmoConfig(options)
    // then
    expect(loaded.config.computer?.env).toEqual({
      DISPLAY: ":98", XAUTHORITY: "${HOME}/literal", XDG_RUNTIME_DIR: "/run/user/1000", WAYLAND_DISPLAY: null,
    })
    expect(loaded.diagnostics.map((entry) => ({ kind: entry.kind, keys: entry.issuePaths }))).toEqual([
      { kind: "invalid-value", keys: ["computer.env.LD_PRELOAD"] },
      { kind: "invalid-value", keys: ["[native].computer.env.PATH"] },
      { kind: "invalid-value", keys: ["profiles.desktop.computer.env.DBUS_SESSION_BUS_ADDRESS"] },
      { kind: "invalid-value", keys: ["profiles.desktop.[native].computer.env.OTHER"] },
    ])
    expect(JSON.stringify(loaded.diagnostics)).not.toContain("/private/")
    expect(JSON.stringify(loaded.layers)).not.toContain("/private/")
  })
})
