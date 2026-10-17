import { describe, expect, test } from "bun:test"

import {
  canonicalRemoteUrl,
  localBinding,
  mintLocalBinding,
  namedBinding,
  parseBinding,
  repoBinding,
  spaceIdForBinding,
  syncedAgentDirName,
} from "./index"

describe("canonicalRemoteUrl (sync-design §3)", () => {
  const table: readonly (readonly [string, string])[] = [
    ["git@github.com:a/b.git", "github.com/a/b"],
    ["git@github.com:/a/b.git", "github.com/a/b"],
    ["https://github.com/a/b.GIT/", "github.com/a/b"],
    ["ssh://git@github.com/a/b", "github.com/a/b"],
    ["https://github.com/a/b", "github.com/a/b"],
    ["https://github.com/a/b.git", "github.com/a/b"],
    ["https://github.com/a/b/", "github.com/a/b"],
    ["https://github.com/a/b.git/", "github.com/a/b"],
    ["https://user:pass@github.com/a/b.git", "github.com/a/b"],
    ["ssh://git@github.com:22/a/b", "github.com/a/b"],
    ["https://github.com:443/a/b", "github.com/a/b"],
    ["http://github.com:80/a/b", "github.com/a/b"],
    ["git://github.com:9418/a/b", "github.com/a/b"],
    ["ssh://git@github.com:2222/a/b", "github.com:2222/a/b"],
    ["https://GITHUB.COM/a/b", "github.com/a/b"],
    ["git@GITHUB.COM:a/b.git", "github.com/a/b"],
    ["git://github.com/a/b", "github.com/a/b"],
    ["github.com/a/b", "github.com/a/b"],
    ["git@gitlab.com:group/sub/proj.git", "gitlab.com/group/sub/proj"],
    ["https://github.com/A/B", "github.com/A/B"],
  ]
  for (const [input, want] of table) {
    test(`${input} -> ${want}`, () => {
      expect(canonicalRemoteUrl(input)).toBe(want)
    })
  }

  test("the design's three spellings are one project", () => {
    const canonical = canonicalRemoteUrl("git@github.com:a/b.git")
    expect(canonicalRemoteUrl("ssh://git@github.com/a/b")).toBe(canonical)
    expect(canonicalRemoteUrl("https://github.com/a/b")).toBe(canonical)
  })
})

describe("namedBinding", () => {
  test("is the trimmed, NFC-normalised profile value", () => {
    expect(namedBinding("  Dori \n")).toBe("named:Dori")
    expect(namedBinding("Ångström")).toBe(namedBinding("Ångström"))
  })

  test("rejects an empty value", () => {
    expect(() => namedBinding("   ")).toThrow(TypeError)
  })
})

describe("localBinding", () => {
  test("carries 128 random bits as hex", () => {
    const hex = "ab".repeat(16)
    expect(localBinding(hex)).toBe(`local:${hex}`)
  })

  test("rejects malformed entropy", () => {
    expect(() => localBinding("zz")).toThrow(TypeError)
    expect(() => localBinding("ab".repeat(15))).toThrow(TypeError)
  })

  test("mintLocalBinding mints distinct valid bindings", () => {
    const a = mintLocalBinding()
    const b = mintLocalBinding()
    expect(a).toMatch(/^local:[0-9a-f]{32}$/)
    expect(b).toMatch(/^local:[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })
})

describe("parseBinding", () => {
  test("round-trips every kind", () => {
    expect(parseBinding("named:Dori")).toEqual({ kind: "named", value: "Dori" })
    expect(parseBinding("repo:github.com/a/b")).toEqual({ kind: "repo", value: "github.com/a/b" })
    expect(parseBinding(`local:${"0".repeat(32)}`)).toEqual({ kind: "local", value: "0".repeat(32) })
  })

  test("rejects unknown prefixes and empty values", () => {
    expect(parseBinding("bogus:x")).toBeNull()
    expect(parseBinding("repo:")).toBeNull()
    expect(parseBinding("named:")).toBeNull()
    expect(parseBinding("local:xyz")).toBeNull()
    expect(parseBinding("")).toBeNull()
  })
})

describe("spaceIdForBinding", () => {
  test("is the sha-256 of the binding key truncated to 128 bits", () => {
    expect(spaceIdForBinding("repo:github.com/a/b")).toBe("88c3c57d6699688f3cdd91b31b7e9f4d")
    expect(spaceIdForBinding("named:Dori")).toBe("852b47fac13bd6a2f0d23f5b5d4fa103")
    expect(spaceIdForBinding(`local:${"0".repeat(32)}`)).toBe("d3da1211bd7facd874d5837d6caa380c")
  })

  test("is deterministic and binding-distinct", () => {
    expect(spaceIdForBinding("repo:github.com/a/b")).toBe(spaceIdForBinding("repo:github.com/a/b"))
    expect(spaceIdForBinding("repo:github.com/a/b")).not.toBe(spaceIdForBinding("repo:github.com/a/c"))
  })
})

describe("repoBinding", () => {
  test("skips invalid origin URLs and uses another usable remote", () => {
    expect(repoBinding([
      { name: "origin", url: "https://[bad" },
      { name: "upstream", url: "https://github.com/a/b.git" },
    ])).toBe("repo:github.com/a/b")
  })

  test("all invalid URLs mean no repo binding", () => {
    expect(repoBinding([{ name: "origin", url: "https://[bad" }])).toBeNull()
  })

  test("prefers origin", () => {
    const remotes = [
      { name: "upstream", url: "git@github.com:x/y.git" },
      { name: "origin", url: "git@github.com:a/b.git" },
    ]
    expect(repoBinding(remotes)).toBe("repo:github.com/a/b")
  })

  test("without origin takes the alphabetically first remote", () => {
    const remotes = [
      { name: "upstream", url: "git@github.com:x/y.git" },
      { name: "alice", url: "git@github.com:a/b.git" },
    ]
    expect(repoBinding(remotes)).toBe("repo:github.com/a/b")
  })

  test("no remotes means no repo binding", () => {
    expect(repoBinding([])).toBeNull()
  })
})

describe("syncedAgentDirName", () => {
  test("is the agents/ dirname a local-only space gets on other devices", () => {
    expect(syncedAgentDirName("88c3c57d6699688f3cdd91b31b7e9f4d")).toBe("synced-88c3c57d")
  })
})
