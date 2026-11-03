import { expect, test } from "bun:test"
import { resolveBuildId, staticBuildDirectory } from "./build-id.mjs"

const treeA = "a".repeat(40)
const treeB = "b".repeat(40)

test("two builds of different trees get different build ids and different static directories", () => {
  const first = resolveBuildId({ CI: "true", GITHUB_SHA: treeA })
  const second = resolveBuildId({ CI: "true", GITHUB_SHA: treeB })
  expect(first).not.toBe(second)
  expect(staticBuildDirectory(first)).not.toBe(staticBuildDirectory(second))
})

test("building the same tree twice gives the same build id", () => {
  expect(resolveBuildId({ CI: "true", GITHUB_SHA: treeA })).toBe(
    resolveBuildId({ CI: "true", GITHUB_SHA: treeA }),
  )
})

test("a CI build without GITHUB_SHA fails instead of falling back to a shared id", () => {
  expect(() => resolveBuildId({ CI: "true" })).toThrow("GITHUB_SHA is required in CI")
  expect(() => resolveBuildId({ CI: "true", GITHUB_SHA: "" })).toThrow(
    "GITHUB_SHA is required in CI",
  )
})

test("a malformed GITHUB_SHA is refused", () => {
  expect(() => resolveBuildId({ CI: "true", GITHUB_SHA: "build-TfctsWXpff2fKS" })).toThrow(
    "not a full commit sha",
  )
})

test("a local build outside CI leaves the id to Next", () => {
  expect(resolveBuildId({})).toBeNull()
})

// Config contract: the shipped next.config must route the build id through resolveBuildId and leave Next's
// deploymentId unset, because with a deploymentId Next gives every build one constant build id.
test("next.config builds with the commit as its build id and without Next's deploymentId", async () => {
  const previous = process.env.GITHUB_SHA
  process.env.GITHUB_SHA = treeA
  try {
    const { default: config } = await import("../next.config.ts")
    expect(config.deploymentId).toBeUndefined()
    expect(await config.generateBuildId()).toBe(treeA)
    // The inlined id is what puts data-omo-build on <html>; live-asset-inventory relies on that marker.
    expect(config.env.OMO_WEB_BUILD_ID).toBe(treeA)
  } finally {
    if (previous === undefined) delete process.env.GITHUB_SHA
    else process.env.GITHUB_SHA = previous
  }
})
