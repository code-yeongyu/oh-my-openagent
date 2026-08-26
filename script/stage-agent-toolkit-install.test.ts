import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * CI restores a partially populated `node_modules` (the workspace symlinks are created by the root
 * `bun install` whose prepare script triggers this build). `npm ci` then aborts with
 * `EEXIST: file already exists, symlink '../../components/teammode'` because it refuses to
 * overwrite a workspace link it did not create, and the whole senpi plugin build fails before a
 * single test runs. The install therefore has to start from a tree it owns.
 */
const script = readFileSync(
  join(import.meta.dir, "..", "packages", "omo-senpi", "plugin", "scripts", "stage-agent-toolkit.mjs"),
  "utf8",
)

describe("stage-agent-toolkit install", () => {
  describe("#given a node_modules tree left behind by another package manager", () => {
    test("#when npm ci is about to run #then the existing tree is removed first", () => {
      const ciIndex = script.indexOf(`run("npm", ["--prefix", "packages/omo-codex/plugin", "ci"])`)
      expect(ciIndex, "the npm ci call must still exist").toBeGreaterThan(-1)

      const preceding = script.slice(0, ciIndex)
      const removalIndex = preceding.lastIndexOf("codexPluginNodeModules")

      expect(removalIndex, "npm ci must be preceded by a removal of the plugin node_modules").toBeGreaterThan(-1)
    })

    test("#then the removal targets the plugin node_modules and tolerates its absence", () => {
      expect(script).toContain('const codexPluginNodeModules = join(codexPluginRoot, "node_modules")')
      expect(script).toContain("await rm(codexPluginNodeModules, { recursive: true, force: true })")
    })
  })
})
