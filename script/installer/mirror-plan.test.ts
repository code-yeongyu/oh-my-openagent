import { describe, expect, test } from "bun:test"
import { betasToPrune, compareVersions, MirrorPlanError, parseSha256Sums, planMirrorAssets, shouldMoveChannel } from "./mirror-plan"
import { signPut } from "./r2-signed-put"

const hash = (seed: string) => seed.repeat(64).slice(0, 64)
const asset = (name: string, sha: string | null) => ({ name, size: 10, digest: sha === null ? null : `sha256:${sha}` })
const sums = (entries: Record<string, string>) => parseSha256Sums(Object.entries(entries).map(([n, h]) => `${h}  ${n}`).join("\n"))

describe("planMirrorAssets", () => {
  const release = [
    asset("omo-linux-x64", hash("a")),
    asset("omo-darwin-arm64", hash("b")),
    asset("SHA256SUMS", hash("c")),
    asset("senpi-desktop-engine-darwin-arm64", hash("d")),
    asset("notes.txt", hash("e")),
  ]

  test("mirrors binaries, SHA256SUMS and engines, skipping anything else", () => {
    const plan = planMirrorAssets(release, sums({ "omo-linux-x64": hash("a"), "omo-darwin-arm64": hash("b") }))
    expect(plan.map((a) => a.name)).toEqual(["omo-linux-x64", "omo-darwin-arm64", "SHA256SUMS", "senpi-desktop-engine-darwin-arm64"])
    expect(plan[0]?.sha256).toBe(hash("a"))
  })

  test("refuses a binary whose SHA256SUMS entry disagrees with the GitHub digest", () => {
    expect(() => planMirrorAssets(release, sums({ "omo-linux-x64": hash("f"), "omo-darwin-arm64": hash("b") }))).toThrow(MirrorPlanError)
  })

  test("refuses a binary missing from SHA256SUMS, or a SHA256SUMS entry with no asset", () => {
    expect(() => planMirrorAssets(release, sums({ "omo-linux-x64": hash("a") }))).toThrow("omo-darwin-arm64 is missing from SHA256SUMS")
    expect(() =>
      planMirrorAssets(release, sums({ "omo-linux-x64": hash("a"), "omo-darwin-arm64": hash("b"), "omo-linux-arm64": hash("9") })),
    ).toThrow("SHA256SUMS lists omo-linux-arm64")
  })

  test("refuses an asset without a GitHub sha256 digest", () => {
    const noDigest = release.map((a) => (a.name === "senpi-desktop-engine-darwin-arm64" ? asset(a.name, null) : a))
    expect(() => planMirrorAssets(noDigest, sums({ "omo-linux-x64": hash("a"), "omo-darwin-arm64": hash("b") }))).toThrow("no GitHub sha256")
  })
})

describe("versions, channels and retention", () => {
  test("orders pre-releases below their release and numerically among themselves", () => {
    const sorted = ["5.1.0", "5.0.0-beta.9", "5.0.0-beta.10", "5.0.0", "5.1.1"].sort(compareVersions)
    expect(sorted).toEqual(["5.0.0-beta.9", "5.0.0-beta.10", "5.0.0", "5.1.0", "5.1.1"])
  })

  test("a backfill never demotes a channel unless forced", () => {
    expect(shouldMoveChannel("5.1.1", "5.1.0", false)).toBe(false)
    expect(shouldMoveChannel("5.1.1", "5.1.0", true)).toBe(true)
    expect(shouldMoveChannel(null, "5.1.0", false)).toBe(true)
    expect(shouldMoveChannel("5.1.0", "5.1.1", false)).toBe(true)
  })

  test("keeps every stable version and the newest 20 betas, never a pinned one", () => {
    const betas = Array.from({ length: 25 }, (_, index) => `5.0.0-beta.${index + 1}`)
    const pruned = betasToPrune([...betas, "4.0.0", "5.1.1"], new Set(["5.0.0-beta.2"]))
    expect(pruned).toEqual(["5.0.0-beta.5", "5.0.0-beta.4", "5.0.0-beta.3", "5.0.0-beta.1"])
  })
})

describe("signPut", () => {
  const credentials = { accountId: "acct", accessKeyId: "id", secretAccessKey: "secret", bucket: "omo-releases" }
  const at = new Date("2026-09-29T00:00:00.000Z")

  test("signs the payload hash and the checksum so R2 can reject altered bytes", () => {
    const signed = signPut(credentials, "releases/v5.1.1/omo-linux-x64", hash("a"), { "x-amz-meta-sha256": hash("a") }, at)
    expect(signed.url).toBe("https://acct.r2.cloudflarestorage.com/omo-releases/releases/v5.1.1/omo-linux-x64")
    expect(signed.headers["x-amz-content-sha256"]).toBe(hash("a"))
    expect(signed.headers.authorization).toContain("SignedHeaders=host;x-amz-checksum-sha256;x-amz-content-sha256;x-amz-date;x-amz-meta-sha256")
    const other = signPut(credentials, "releases/v5.1.1/omo-linux-x64", hash("b"), { "x-amz-meta-sha256": hash("a") }, at)
    expect(other.headers.authorization).not.toBe(signed.headers.authorization)
  })
})
