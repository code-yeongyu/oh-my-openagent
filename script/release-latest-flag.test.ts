/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolveLatestFlag } from "./release-latest-flag"

const RELEASED = ["v5.0.0-beta.40", "v5.0.0-beta.39", "v5.0.0-beta.20", "v5.0.0-beta.19", "v4.19.4", "_pr-attachments"]

describe("resolveLatestFlag", () => {
  test("#given a version above every published release #when resolved #then it becomes Latest", () => {
    // given / when
    const flag = resolveLatestFlag("5.0.0-beta.41", RELEASED)

    // then
    expect(flag).toBe("--latest")
  })

  test("#given an older-line hotfix below a published release #when resolved #then Latest is left alone", () => {
    // given / when
    const flag = resolveLatestFlag("4.19.5", RELEASED)

    // then
    expect(flag).toBe("--latest=false")
  })

  test("#given a rerun for an already published version #when resolved #then it still resolves to Latest", () => {
    // given / when
    const flag = resolveLatestFlag("5.0.0-beta.40", RELEASED)

    // then
    expect(flag).toBe("--latest")
  })

  test("#given a stable version after its own betas #when resolved #then the stable becomes Latest", () => {
    // given / when
    const flag = resolveLatestFlag("5.0.0", RELEASED)

    // then
    expect(flag).toBe("--latest")
  })

  test("#given multi-digit prerelease counters #when compared #then ordering is numeric, not lexical", () => {
    // given / when / then
    expect(resolveLatestFlag("5.0.0-beta.10", ["v5.0.0-beta.9"])).toBe("--latest")
    expect(resolveLatestFlag("5.0.0-beta.9", ["v5.0.0-beta.10"])).toBe("--latest=false")
    expect(resolveLatestFlag("5.0.0-beta.100", ["v5.0.0-beta.99"])).toBe("--latest")
  })

  test("#given tags that are not semver #when resolved #then they are ignored instead of throwing", () => {
    // given
    const tags = ["_pr-attachments", "next", "release-notes", "", "v5.0.0-beta.40"]

    // when / then
    expect(resolveLatestFlag("5.0.0-beta.41", tags)).toBe("--latest")
    expect(resolveLatestFlag("5.0.0-beta.39", tags)).toBe("--latest=false")
  })

  test("#given a leading v on the candidate #when resolved #then it is tolerated like the tag list", () => {
    // given / when / then
    expect(resolveLatestFlag("v5.0.0-beta.41", RELEASED)).toBe("--latest")
    expect(resolveLatestFlag("v4.19.5", RELEASED)).toBe("--latest=false")
  })

  test("#given no published releases yet #when resolved #then the first release is Latest", () => {
    // given / when / then
    expect(resolveLatestFlag("0.1.0", [])).toBe("--latest")
  })

  test("#given a candidate that is not a release version #when resolved #then it throws instead of guessing", () => {
    // given / when / then
    expect(() => resolveLatestFlag("next", RELEASED)).toThrow()
    expect(() => resolveLatestFlag("5.0.0-beta.41+build.7", RELEASED)).toThrow()
  })
})

describe("local publish path", () => {
  test("#given the local publish script #when it creates a release #then it passes a resolved flag from the published tags", () => {
    // given: publish.ts is the second release-creation path, so the badge rule must not be
    // reimplemented or omitted there. It has no importable seam (top-level side effects), so the
    // machine-consumed facts are pinned from source.
    const source = readFileSync(new URL("./publish.ts", import.meta.url), "utf8")

    // when
    const createLine = source
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.includes("gh release create"))

    // then
    expect(source).toContain('import { resolveLatestFlag } from "./release-latest-flag"')
    expect(source).toContain("gh release list --exclude-drafts")
    expect(createLine).toContain("${latestFlag}")
    expect(createLine).not.toContain("--prerelease")
    expect(createLine).not.toContain("--latest ")
  })
})
