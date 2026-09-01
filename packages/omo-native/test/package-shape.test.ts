import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

/**
 * Pins the published contract of the omo-ai npm package. Every assertion guards
 * a property that, if changed, would break the beta-channel install or the
 * bin-ownership invariant (the `omo` command belongs to omo-ai, not the legacy
 * root package). Shape only - launcher behavior is covered by launcher.test.ts.
 */
const manifestPath = resolve(import.meta.dir, "..", "package.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  name: string
  bin?: Record<string, string>
  files?: string[]
  engines?: { node?: string }
  dependencies?: Record<string, string>
  repository?: { type?: string; url?: string }
  private?: boolean
  scripts?: Record<string, string>
}

describe("omo-ai published package shape", () => {
  describe("#given the omo-native package manifest", () => {
    describe("#when the bin map is audited", () => {
      test("#then it exposes exactly the omo command pointing at bin/omo.js", () => {
        expect(manifest.bin).toEqual({ omo: "bin/omo.js" })
      })

      test("#then omo-agent-toolkit is absent from the bin map", () => {
        expect(manifest.bin).not.toHaveProperty("omo-agent-toolkit")
      })
    })

    describe("#when the files array is audited", () => {
      test("#then it ships the launcher, plugin, and published Senpi patch installer", () => {
        expect(manifest.files).toEqual(["bin", "plugin"])
      })
    })

    describe("#when the engines field is audited", () => {
      test("#then node requires version 24 or higher", () => {
        expect(manifest.engines?.node).toBe(">=24.0.0")
      })
    })

    describe("#when the dependencies are audited", () => {
      test("#then it declares exactly the engine and codemode parser runtime dependencies", () => {
        expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
          "@babel/parser",
          "@code-yeongyu/senpi",
        ])
      })

      test("#then the codemode parser dependency is exactly pinned", () => {
        expect(manifest.dependencies?.["@babel/parser"]).toBe("8.0.4")
      })

      test("#then the senpi pin is exact with no range operator", () => {
        const pin = manifest.dependencies?.["@code-yeongyu/senpi"]
        expect(pin).toBe("2026.8.31")
        expect(pin).toMatch(/^\d/)
        expect(pin).not.toMatch(/^[\^~]/)
      })
    })

    describe("#when the repository field is audited", () => {
      test("#then it points at the canonical github url", () => {
        expect(manifest.repository?.url).toBe(
          "git+https://github.com/code-yeongyu/oh-my-openagent.git",
        )
      })
    })

    describe("#when the private flag is audited", () => {
      test("#then the package is publishable (private absent or false)", () => {
        expect(manifest.private ?? false).toBe(false)
      })
    })

    describe("#when the scripts are audited", () => {
      test("#then no prepack lifecycle hook exists", () => {
        expect(manifest.scripts?.prepack).toBeUndefined()
      })

      test("#then postinstall applies the shipped Senpi patch", () => {
        expect(manifest.scripts?.postinstall).toBe("node bin/senpi-patch.mjs")
      })
    })
  })
})
