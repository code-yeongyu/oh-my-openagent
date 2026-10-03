import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync, statSync } from "node:fs"

import { createNativeSkillSources, sharedAssetSourceFor } from "./native-skill-sources.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(scriptDir, "..", "..", "..")
const nativeSkillsRoot = join(repoRoot, "omo-senpi", "skills")
const sharedSkillsRoot = join(repoRoot, "shared-skills", "skills")

describe("createNativeSkillSources", () => {
  const { sources, names } = createNativeSkillSources(repoRoot)

  const expectedOrderedNames = [
    "dag-library",
    "give-me-tips",
    "hyperplan",
    "init-deep",
    "mass-ulw",
    "onboarding",
    "ultrawork",
    "ulw-plan",
    "ulw-research",
  ]

  test("#given the registry #when ordered names are extracted #then they match the expected alphabetical sequence including onboarding", () => {
    const actualNames = sources.map(({ name }) => name)
    assert.deepEqual(actualNames, expectedOrderedNames)
  })

  test("#given the registry #when the name set is built #then it contains exactly the same entries as the ordered list", () => {
    assert.deepEqual([...names].sort(), [...expectedOrderedNames].sort())
    assert.equal(names.size, expectedOrderedNames.length)
  })

  test("#given each source entry #when the path is resolved #then it points to an existing directory under the native skills root", () => {
    for (const { name, source } of sources) {
      const expectedPath = join(nativeSkillsRoot, name)
      assert.equal(source, expectedPath, `source path for "${name}" must resolve under native skills root`)
      assert.ok(existsSync(source), `source directory for "${name}" must exist at ${source}`)
      assert.ok(statSync(source).isDirectory(), `source for "${name}" must be a directory`)
    }
  })

  test("#given the registry #when sharedAssets are read #then only ulw-research overlays the shared runtime and reference", () => {
    const withSharedAssets = sources.filter((entry) => entry.sharedAssets !== undefined).map(({ name }) => name)
    assert.deepEqual(withSharedAssets, ["ulw-research"])

    const ulwResearch = sources.find(({ name }) => name === "ulw-research")
    assert.deepEqual(ulwResearch?.sharedAssets, ["scripts", "references/report-gates.md", "references/deliverable-phase.md"])
  })

  test("#given each sharedAssets path #when resolved against the shared skill #then it is relative, contained, and exists", () => {
    for (const { name, sharedAssets } of sources) {
      for (const asset of sharedAssets ?? []) {
        assert.equal(isAbsolute(asset), false, `${name} shared asset ${asset} must be relative`)
        assert.equal(asset.split("/").includes(".."), false, `${name} shared asset ${asset} must stay inside the skill`)
        const sharedPath = join(sharedSkillsRoot, name, asset)
        assert.ok(existsSync(sharedPath), `${name} shared asset must exist at ${sharedPath}`)
      }
    }
  })
})

describe("sharedAssetSourceFor", () => {
  test("#given a path inside a native skill's shared asset #when resolved #then it maps to the shared source it is overlaid from", () => {
    const shipped = join(nativeSkillsRoot, "ulw-research", "references", "report-gates.md")
    assert.equal(sharedAssetSourceFor(repoRoot, shipped), join(sharedSkillsRoot, "ulw-research", "references", "report-gates.md"))
    const script = join(nativeSkillsRoot, "ulw-research", "scripts", "report-tools.mjs")
    assert.equal(sharedAssetSourceFor(repoRoot, script), join(sharedSkillsRoot, "ulw-research", "scripts", "report-tools.mjs"))
  })

  test("#given a path outside every shared asset #when resolved #then it is null", () => {
    assert.equal(sharedAssetSourceFor(repoRoot, join(nativeSkillsRoot, "ulw-research", "references", "missing.md")), null)
    assert.equal(sharedAssetSourceFor(repoRoot, join(nativeSkillsRoot, "ulw-plan", "references", "report-gates.md")), null)
    assert.equal(sharedAssetSourceFor(repoRoot, join(repoRoot, "omo-senpi", "README.md")), null)
  })
})
