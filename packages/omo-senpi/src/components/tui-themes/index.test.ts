import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  BUNDLED_THEME_NAMES,
  createTuiThemesComponent,
  resolveBundledThemesDir,
  TUI_THEMES_COMPONENT_NAME,
} from "./index"

describe("createTuiThemesComponent", () => {
  describe("#given the component is registered", () => {
    test("#then it is named tui-themes", () => {
      expect(createTuiThemesComponent().name).toBe(TUI_THEMES_COMPONENT_NAME)
    })

    test("#when resources_discover fires #then the packaged themes directory is contributed", async () => {
      // given
      const pi = new FakeExtensionAPI()
      createTuiThemesComponent().register(pi, {
        logger: { info() {}, warn() {}, error() {} },
        config: { getFlag: () => undefined },
      })

      // when
      const [result] = await pi.dispatch("resources_discover", { cwd: process.cwd(), reason: "startup" })

      // then
      expect(result).toEqual({ themePaths: [resolveBundledThemesDir() as string] })
    })
  })

  describe("#given an explicit themes directory", () => {
    test("#when resources_discover fires #then that directory is contributed verbatim", async () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), "omo-themes-"))
      const pi = new FakeExtensionAPI()
      createTuiThemesComponent({ themesDir: dir }).register(pi, {
        logger: { info() {}, warn() {}, error() {} },
        config: { getFlag: () => undefined },
      })

      // when
      const [result] = await pi.dispatch("resources_discover", {})

      // then
      expect(result).toEqual({ themePaths: [dir] })
    })
  })

  describe("#given the packaged themes directory is absent", () => {
    test("#when resources_discover fires #then nothing is contributed and no throw escapes", async () => {
      // given
      const empty = mkdtempSync(join(tmpdir(), "omo-no-themes-"))
      const absent = join(empty, "missing")
      mkdirSync(join(empty, "keep"))
      writeFileSync(join(empty, "keep", "placeholder"), "")
      const pi = new FakeExtensionAPI()
      createTuiThemesComponent({ themesDir: absent }).register(pi, {
        logger: { info() {}, warn() {}, error() {} },
        config: { getFlag: () => undefined },
      })

      // when
      const results = await pi.dispatch("resources_discover", {})

      // then
      expect(results).toEqual([undefined])
    })
  })
})

describe("resolveBundledThemesDir", () => {
  test("#given the source tree #when resolved #then the packaged themes directory is found", () => {
    // when
    const dir = resolveBundledThemesDir()

    // then
    expect(dir?.endsWith(join("omo-senpi", "plugin", "themes"))).toBe(true)
  })

  test("#given the shipped theme names #when read from disk #then every declared theme file exists", () => {
    // given
    const dir = resolveBundledThemesDir()

    // when / then
    expect(dir).toBeDefined()
    for (const name of BUNDLED_THEME_NAMES) {
      expect(Bun.file(join(dir as string, `${name}.json`)).size).toBeGreaterThan(0)
    }
  })
})
