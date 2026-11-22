import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { installLocalLauncher, localLauncherPath, renderLocalLauncher, uninstallLocalLauncher } from "./local-launcher"

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "omo-local-launcher-"))
}

// Compared over LF: a Windows checkout may hand the asset back with CRLF.
const ICON = readFileSync(
  resolve(fileURLToPath(new URL("../../../..", import.meta.url)), ".github/assets/omo-icon-light.svg"),
  "utf8",
).replaceAll("\r\n", "\n")
const LOGO_PREFIX = "data:image/svg+xml;base64,"

const BASE = {
  pluginPath: "/repo/packages/omo-senpi/plugin",
  senpiCliPath: "/repo/senpi/dist/cli.js",
  version: "9.9.9",
}

describe("local omo launcher", () => {
  describe("#given a launch through the generated launcher", () => {
    test("#then the brand names exactly the plugin it prepends with --extension (#14465)", () => {
      const home = makeHome()
      try {
        const cli = join(home, "capture-cli.mjs")
        const out = join(home, "capture.json")
        writeFileSync(
          cli,
          `import { writeFileSync } from "node:fs"\nwriteFileSync(${JSON.stringify(out)}, JSON.stringify({ argv: process.argv.slice(2), brand: process.env.SENPI_BRAND }))\n`,
        )
        const launcher = join(home, "omo.mjs")
        writeFileSync(launcher, renderLocalLauncher({ ...BASE, senpiCliPath: cli }))
        const plugin = join(home, "plugin-override")
        const result = spawnSync(process.execPath, [launcher, "say", "hi"], {
          env: { ...process.env, OMO_PLUGIN_ROOT: plugin, OMO_SENPI_CLI_PATH: cli },
          encoding: "utf8",
        })
        expect(result.status).toBe(0)
        const captured = JSON.parse(readFileSync(out, "utf8")) as { argv: string[]; brand: string }
        expect(captured.argv).toEqual(["--extension", plugin, "say", "hi"])
        expect(JSON.parse(captured.brand).extensions).toEqual([plugin])
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    })
  })

  describe("#given a sibling-store install", () => {
    describe("#when the launcher is rendered", () => {
      test("#then it hands the engine the same product identity as the published launcher", () => {
        const source = renderLocalLauncher(BASE)
        const brand = JSON.parse(source.match(/const brand = (\{.*\})/)?.[1] ?? "{}")

        // The provider sign-in result page shows this mark (senpi#4432).
        expect(typeof brand.logo).toBe("string")
        expect(brand.logo.startsWith(LOGO_PREFIX)).toBe(true)
        expect(Buffer.from(brand.logo.slice(LOGO_PREFIX.length), "base64").toString("utf8")).toBe(ICON)
        expect(brand).toEqual({
          name: "OmO",
          logo: brand.logo,
          command: "omo",
          displayVersion: "9.9.9",
          configDir: ".omo",
          flatLayout: false,
          envPrefix: "OMO",
          userAgent: "omo",
          originator: "omo",
          // A local sibling-store install points at the repo plugin dir and deliberately carries
          // no version: without one the engine treats the source as read-only and renders no
          // startup notes, which is what a dev install should do.
          changelog: {
            path: "/repo/packages/omo-senpi/plugin/CHANGELOG.md",
          },
          update: {
            packageName: "omo-ai",
            distTag: "latest",
            command: "bun add -g omo-ai",
            changelogUrl: "https://github.com/code-yeongyu/oh-my-openagent/releases",
          },
        })
        expect(source).toContain("omo is updated via bun: bun add -g omo-ai")
        expect(source).not.toContain("omo-ai@beta")
        expect(source).toContain("--extension")
        expect(source).toContain("OMO_SENPI_CLI_PATH")
        expect(source).toContain("OMO_PLUGIN_ROOT")
        expect(source).toContain("OMO_CODING_AGENT_DIR")
        expect(source).toContain("SENPI_CODING_AGENT_DIR")
        expect(source).toContain('join(homedir(), ".omo", "agent")')
      })

      test("#then a prerelease build stays on the beta channel", () => {
        const source = renderLocalLauncher({ ...BASE, version: "5.0.0-beta.90" })
        const brand = JSON.parse(source.match(/const brand = (\{.*\})/)?.[1] ?? "{}")

        expect(brand.update).toMatchObject({ distTag: "beta", command: "bun add -g omo-ai@beta" })
        expect(source).toContain("omo is updated via bun: bun add -g omo-ai@beta")
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
