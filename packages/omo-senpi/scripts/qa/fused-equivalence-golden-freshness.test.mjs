import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const goldenRoot = join(scriptDir, "fused-equivalence-golden")
const repoRoot = join(scriptDir, "..", "..", "..", "..")
const SENPI = "@code-yeongyu/senpi"
const MAX_LAG_DAYS = 7
const MS_PER_DAY = 86_400_000

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))

// senpi versions are release dates: 2026.11.15-2 is the second cut of 2026-11-15
function releaseDay(version) {
  const match = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-\d+)?$/.exec(version ?? "")
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY : undefined
}

function recordedSenpiVersion(platform) {
  const { runtimes } = readJson(join(goldenRoot, platform, "baseline.json"))
  return runtimes.child
    .split(" ")
    .find((part) => part.startsWith(`${SENPI}@`))
    ?.slice(SENPI.length + 1)
}

describe("EQ.omo goldens", () => {
  test(`#given every platform with recorded goldens #when its baseline is read #then its senpi version is within ${MAX_LAG_DAYS} days of the pinned one`, () => {
    // given: CI compares the linux-x64 goldens only, so another platform's files can keep an older engine's prompt unnoticed
    const pinned = readJson(join(repoRoot, "package.json")).devDependencies[SENPI]
    const platforms = readdirSync(goldenRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    // when
    const stale = platforms.flatMap((platform) => {
      const recorded = recordedSenpiVersion(platform)
      const lag = Math.abs(releaseDay(pinned) - releaseDay(recorded))
      return lag <= MAX_LAG_DAYS
        ? []
        : [`${platform}: recorded with senpi ${recorded}, pinned ${pinned} (${lag} days apart)`]
    })

    // then
    expect(platforms.length).toBeGreaterThan(0)
    expect(stale).toEqual([])
  })
})
