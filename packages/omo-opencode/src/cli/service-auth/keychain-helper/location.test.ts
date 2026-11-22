import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { bundleCandidates, locateHelper, machineCandidates, storeCandidates } from "./location"
import type { SignatureVerdict } from "./signature"

const verdicts =
  (table: Record<string, SignatureVerdict>) =>
  async (path: string): Promise<SignatureVerdict> =>
    table[path] ?? "missing"

describe("keychain helper location (#11262 design 1, addendum rows 9-10)", () => {
  test("#given a bundle file #when candidates are listed #then two levels up from its directory comes first, bin/darwin before the runtime root", () => {
    // Real local paths on every host: the candidates are derived from the bundle's own file location.
    const pkg = join(tmpdir(), "pkg", "omo-ai")
    expect(bundleCandidates(pathToFileURL(join(pkg, "bin", "lib", "service-auth.generated.js")).href)).toEqual([
      join(pkg, "bin", "darwin", "omo-keychain"),
      join(pkg, "omo-keychain"),
    ])
    const runtime = join(tmpdir(), "App", "omo-runtime", "darwin-arm64")
    expect(bundleCandidates(pathToFileURL(join(runtime, "plugin", "extensions", "omo-feedback.js")).href)).toEqual([
      join(runtime, "bin", "darwin", "omo-keychain"),
      join(runtime, "omo-keychain"),
    ])
  })

  test("#given the machine #when other copies are listed #then the app bundle comes first and nothing comes from PATH or env", () => {
    const listed = machineCandidates("/Users/someone", "arm64")
    expect(listed[0]).toBe("/Applications/OmO.app/Contents/Resources/omo-runtime/darwin-arm64/omo-keychain")
    expect(machineCandidates("/Users/someone", "x64")[0]).toContain("darwin-x64")
    expect(listed.every((path) => path.startsWith("/"))).toBe(true)
  })

  test("#given a missing first candidate #when locating #then the next valid copy is used", async () => {
    expect(await locateHelper(["/a", "/b"], verdicts({ "/b": "valid" }))).toEqual({ kind: "found", path: "/b" })
  })

  test("#given a present candidate failing its signature #when locating #then it is never used, only a later VERIFIED copy is", async () => {
    expect(await locateHelper(["/bad", "/good"], verdicts({ "/bad": "invalid", "/good": "valid" }))).toEqual({
      kind: "found",
      path: "/good",
    })
    expect(await locateHelper(["/bad", "/missing"], verdicts({ "/bad": "invalid" }))).toEqual({
      kind: "invalid",
      rejected: ["/bad"],
    })
  })

  test("#given no candidate on the machine #when locating #then the helper is missing", async () => {
    expect(await locateHelper(["/a", "/b"], verdicts({}))).toEqual({ kind: "missing" })
  })

  // #13102: a compiled entry that registers nothing must still find the helper beside its own executable.
  test("#given a compiled bundle under /$bunfs and no registered candidate #when the store searches #then the helper beside the executable is found before machine-wide copies", async () => {
    const runtime = join(tmpdir(), "OmO (Nightly).app", "Contents", "Resources", "omo-runtime", "darwin-arm64")
    const beside = join(runtime, "omo-keychain")
    const candidates = storeCandidates({
      registered: [],
      moduleUrl: "file:///$bunfs/root/omo.js",
      execPath: join(runtime, "omo"),
      home: "/Users/someone",
    })
    expect(candidates.indexOf(beside)).toBeGreaterThan(-1)
    expect(candidates.indexOf(beside)).toBeLessThan(candidates.indexOf(machineCandidates("/Users/someone")[0] ?? ""))
    expect(await locateHelper(candidates, verdicts({ [beside]: "valid" }))).toEqual({ kind: "found", path: beside })
  })

  test("#given a registered entry candidate #when the store searches #then it still comes first", () => {
    const candidates = storeCandidates({
      registered: ["/entry/omo-keychain"],
      moduleUrl: "file:///$bunfs/root/omo.js",
      execPath: "/x/omo",
      home: "/h",
    })
    expect(candidates[0]).toBe("/entry/omo-keychain")
  })
})
