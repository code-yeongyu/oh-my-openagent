import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { installLocalLauncher, localLauncherPath, renderLocalLauncher, uninstallLocalLauncher } from "./local-launcher"

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "omo-local-launcher-"))
}

const BASE = { pluginPath: "/repo/packages/omo-senpi/plugin", senpiCliPath: "/repo/senpi/dist/cli.js", version: "9.9.9" }

describe("local omo launcher", () => {
  describe("#given a sibling-store install", () => {
    describe("#when the launcher is rendered", () => {
      test("#then it hands the engine the same product identity as the published launcher", () => {
        const source = renderLocalLauncher(BASE)
        const brand = JSON.parse(source.match(/const brand = (\{.*\})/)?.[1] ?? "{}")

        expect(brand).toEqual({
          name: "omo",
          displayVersion: "9.9.9",
          configDir: ".omo",
          flatLayout: false,
          envPrefix: "OMO",
          userAgent: "omo",
          originator: "omo",
          update: {
            packageName: "omo-ai",
            distTag: "beta",
            command: "npm i -g omo-ai@beta",
            changelogUrl: "https://github.com/code-yeongyu/oh-my-openagent/releases",
          },
        })
        expect(source).toContain("--extension")
        expect(source).toContain("OMO_SENPI_CLI_PATH")
        expect(source).toContain("OMO_PLUGIN_ROOT")
        expect(source).toContain("OMO_CODING_AGENT_DIR")
        expect(source).toContain("SENPI_CODING_AGENT_DIR")
        expect(source).toContain('join(homedir(), ".omo", "agent")')
      })
    })

    describe("#when it is installed", () => {
      test("#then it lands executable on the user's PATH directory", () => {
        const home = makeHome()
        const path = installLocalLauncher({ ...BASE, homeDir: home })

        expect(path).toBe(localLauncherPath(home))
        expect(existsSync(path ?? "")).toBe(true)
        expect(readFileSync(path ?? "", "utf8")).toContain("omo-local-launcher")

        rmSync(home, { recursive: true, force: true })
      })

      test("#then reinstalling is idempotent", () => {
        const home = makeHome()
        installLocalLauncher({ ...BASE, homeDir: home })
        const second = installLocalLauncher({ ...BASE, homeDir: home })

        expect(second).toBe(localLauncherPath(home))

        rmSync(home, { recursive: true, force: true })
      })

      test("#then a foreign file at that path is never overwritten", () => {
        const home = makeHome()
        const path = localLauncherPath(home)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, "#!/bin/sh\necho mine\n")

        expect(installLocalLauncher({ ...BASE, homeDir: home })).toBeUndefined()
        expect(readFileSync(path, "utf8")).toContain("echo mine")

        rmSync(home, { recursive: true, force: true })
      })
    })

    describe("#when it is uninstalled", () => {
      test("#then only a generated launcher is removed", () => {
        const home = makeHome()
        installLocalLauncher({ ...BASE, homeDir: home })

        expect(uninstallLocalLauncher(home)).toBe(true)
        expect(existsSync(localLauncherPath(home))).toBe(false)
        expect(uninstallLocalLauncher(home)).toBe(false)

        rmSync(home, { recursive: true, force: true })
      })

      test("#then a foreign file survives", () => {
        const home = makeHome()
        const path = localLauncherPath(home)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, "#!/bin/sh\necho mine\n")

        expect(uninstallLocalLauncher(home)).toBe(false)
        expect(existsSync(path)).toBe(true)

        rmSync(home, { recursive: true, force: true })
      })
    })
  })
})
