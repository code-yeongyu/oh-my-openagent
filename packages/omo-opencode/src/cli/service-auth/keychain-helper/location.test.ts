import { describe, expect, test } from "bun:test"
import { bundleCandidates, locateHelper, machineCandidates } from "./location"
import type { SignatureVerdict } from "./signature"

const verdicts = (table: Record<string, SignatureVerdict>) => async (path: string): Promise<SignatureVerdict> => table[path] ?? "missing"

describe("keychain helper location (#11262 design 1, addendum rows 9-10)", () => {
  test("#given a bundle file #when candidates are listed #then two levels up from its directory comes first, bin/darwin before the runtime root", () => {
    expect(bundleCandidates("file:///pkg/omo-ai/bin/lib/service-auth.generated.js")).toEqual([
      "/pkg/omo-ai/bin/darwin/omo-keychain",
      "/pkg/omo-ai/omo-keychain",
    ])
    expect(bundleCandidates("file:///App/omo-runtime/darwin-arm64/plugin/extensions/omo-feedback.js")).toEqual([
      "/App/omo-runtime/darwin-arm64/bin/darwin/omo-keychain",
      "/App/omo-runtime/darwin-arm64/omo-keychain",
    ])
  })

  test("#given the machine #when other copies are listed #then the app bundle comes first and nothing comes from PATH or env", () => {
    const listed = machineCandidates("/Users/someone", "arm64")
    expect(listed[0]).toBe("/Applications/OmO.app/Contents/Resources/omo-runtime/darwin-arm64/omo-keychain")
    expect(machineCandidates("/Users/someone", "x64")[0]).toContain("darwin-x64")
    expect(listed.every(path => path.startsWith("/"))).toBe(true)
  })

  test("#given a missing first candidate #when locating #then the next valid copy is used", async () => {
    expect(await locateHelper(["/a", "/b"], verdicts({ "/b": "valid" }))).toEqual({ kind: "found", path: "/b" })
  })

  test("#given a present candidate failing its signature #when locating #then it is never used, only a later VERIFIED copy is", async () => {
    expect(await locateHelper(["/bad", "/good"], verdicts({ "/bad": "invalid", "/good": "valid" }))).toEqual({ kind: "found", path: "/good" })
    expect(await locateHelper(["/bad", "/missing"], verdicts({ "/bad": "invalid" }))).toEqual({ kind: "invalid", rejected: ["/bad"] })
  })

  test("#given no candidate on the machine #when locating #then the helper is missing", async () => {
    expect(await locateHelper(["/a", "/b"], verdicts({}))).toEqual({ kind: "missing" })
  })
})
