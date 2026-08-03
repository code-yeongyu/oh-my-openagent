import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SUPPORTED_SENPI_VERSION = "2026.8.3-3"
const repoRoot = join(import.meta.dir, "..", "..", "..")

describe("Senpi child runtime alignment", () => {
  test.each([
    "packages/omo-senpi/package.json",
    "packages/senpi-task/package.json",
  ])("%s resolves child sessions with the supported host SDK", (relativeManifestPath) => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, relativeManifestPath), "utf8"),
    ) as {
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }

    expect(manifest.devDependencies?.["@code-yeongyu/senpi"]).toBe(SUPPORTED_SENPI_VERSION)
    expect(manifest.peerDependencies?.["@code-yeongyu/senpi"]).toBe(`>=${SUPPORTED_SENPI_VERSION}`)
  })
})
