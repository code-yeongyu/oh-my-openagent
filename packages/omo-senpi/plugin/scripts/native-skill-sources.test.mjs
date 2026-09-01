import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync, statSync } from "node:fs"

import { createNativeSkillSources } from "./native-skill-sources.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(scriptDir, "..", "..", "..")
const nativeSkillsRoot = join(repoRoot, "omo-senpi", "skills")

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

  test("#given onboarding skill #when checked #then it is present in the registry at the correct position", () => {
    const onboardingEntry = sources.find(({ name }) => name === "onboarding")
    assert.ok(onboardingEntry, "onboarding must be in the registry")
    assert.equal(sources.indexOf(onboardingEntry), 5, "onboarding must be at index 5 (alphabetical)")
    assert.equal(onboardingEntry.source, join(nativeSkillsRoot, "onboarding"))
  })
})
