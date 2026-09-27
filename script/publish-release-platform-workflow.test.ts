/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"

import { PLATFORMS } from "./build-binaries"

const publishWorkflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
const publishPlatformWorkflowPath = new URL("../.github/workflows/publish-platform.yml", import.meta.url)

function sliceWorkflowSection(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`missing workflow section between ${startMarker} and ${endMarker}`)
  }
  return workflow.slice(start, end)
}

describe("release and platform publish workflows", () => {
  test("enumerates windows-arm64 consistently across every platform-list surface", () => {
    // #given
    const publishSource = readFileSync(new URL("../script/publish.ts", import.meta.url), "utf8")
    const publishPlatformWorkflow = readFileSync(publishPlatformWorkflowPath, "utf8")

    const publishIdsBlock = publishSource.slice(
      publishSource.indexOf("PLATFORM_PACKAGE_IDS = ["),
      publishSource.indexOf("] as const"),
    )
    const publishIds = [...publishIdsBlock.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]).sort()

    const buildBinariesPlatforms = PLATFORMS.map((entry) => entry.platform).sort()

    const matrixLists = [...publishPlatformWorkflow.matchAll(/^\s*platform: \[([^\]]+)\]/gm)].map((match) =>
      match[1]
        .split(",")
        .map((value) => value.trim())
        .sort(),
    )

    const publishWorkflow = readFileSync(publishWorkflowPath, "utf8")
    const publishYmlLists = [
      ...[...publishWorkflow.matchAll(/PLATFORMS=\(([^)]+)\)/g)].map((match) => match[1]),
      ...[...publishWorkflow.matchAll(/for platform in (darwin-arm64[^\n;]*); do/g)].map((match) => match[1]),
    ].map((list) => list.trim().split(/\s+/).sort())

    // #when / #then
    expect(publishIds, "PLATFORM_PACKAGE_IDS must list windows-arm64").toContain("windows-arm64")
    expect(buildBinariesPlatforms, "build-binaries PLATFORMS must list windows-arm64").toContain("windows-arm64")
    expect(matrixLists.length, "publish-platform.yml must define both build and publish matrices").toBe(2)
    for (const matrixList of matrixLists) {
      expect(matrixList, "every publish-platform matrix must list windows-arm64").toContain("windows-arm64")
      expect(matrixList, "publish-platform matrix must match build-binaries PLATFORMS exactly").toEqual(
        buildBinariesPlatforms,
      )
    }
    expect(publishIds, "PLATFORM_PACKAGE_IDS must match build-binaries PLATFORMS exactly").toEqual(
      buildBinariesPlatforms,
    )
    expect(publishYmlLists.length, "publish.yml must enumerate platforms in 2 PLATFORMS arrays + 2 prepared-source version-bump loops").toBe(4)
    for (const publishYmlList of publishYmlLists) {
      expect(publishYmlList, "every publish.yml platform list must match build-binaries PLATFORMS exactly").toEqual(
        buildBinariesPlatforms,
      )
    }
  })

  test("matches the canonical platform set in optionalDependencies and on-disk platform packages", () => {
    // #given
    const rootManifest: { optionalDependencies?: Record<string, string> } = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    )
    const buildBinariesPlatforms = PLATFORMS.map((entry) => entry.platform).sort()
    const platformPrefix = "oh-my-opencode-"

    const optionalDependencyPlatforms = Object.keys(rootManifest.optionalDependencies ?? {})
      .filter((name) => name.startsWith(platformPrefix))
      .map((name) => name.slice(platformPrefix.length))
      .sort()

    const onDiskPlatforms = readdirSync(new URL("../packages/", import.meta.url))
      .filter((name) => name.startsWith(platformPrefix))
      .map((name) => name.slice(platformPrefix.length))
      .sort()

    // #when / #then
    expect(
      optionalDependencyPlatforms,
      "root optionalDependencies must list every canonical platform package",
    ).toEqual(buildBinariesPlatforms)
    expect(
      onDiskPlatforms,
      "packages/ must contain a directory for every canonical platform package",
    ).toEqual(buildBinariesPlatforms)
  })
})

describe("release binary asset lane in the platform publish workflow", () => {
})
