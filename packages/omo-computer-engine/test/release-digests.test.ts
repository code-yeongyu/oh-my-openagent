import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { renderReleaseDigests } from "../scripts/pin-release-digests.ts"

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const linux = "a".repeat(64)
const darwin = "b".repeat(64)

describe("release digests pinned in the package", () => {
  it("the generator turns the release's checksums file into the module the launcher reads", async () => {
    // Given the checksums file a release publishes.
    const checksums = `${linux}  omo-computer-engine-linux-x64\n${darwin}  omo-computer-engine-darwin-arm64\n`

    // When the generator renders the module and it is loaded.
    const dir = mkdtempSync(join(tmpdir(), "omo-release-digests-"))
    made.push(dir)
    const module = join(dir, "release-digests.ts")
    writeFileSync(module, renderReleaseDigests(checksums))
    const loaded: unknown = await import(module)

    // Then it exports exactly those digests.
    expect(loaded).toMatchObject({
      RELEASE_DIGESTS: { "omo-computer-engine-linux-x64": linux, "omo-computer-engine-darwin-arm64": darwin },
    })
  })

  it("refuses a checksums file that is not one (the module is never written from garbage)", () => {
    expect(() => renderReleaseDigests("not a checksum line\n")).toThrow(/not a checksum line/)
  })
})
