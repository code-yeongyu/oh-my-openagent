import { describe, expect, test } from "bun:test"
import {
  assertUtcDate,
  composeReleaseBody,
  extractReleaseNotes,
  findPrivateReferences,
  neutralizeCrossRepoReferences,
  stampUnreleased,
} from "./changelog-release-notes"

const CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "### Added",
  "",
  "- a new thing",
  "",
  "## [5.0.0-beta.53] - 2026-09-10",
  "",
  "- an older thing",
  "",
].join("\n")

describe("stampUnreleased", () => {
  test("#given authored notes #when stamped #then a released section appears and Unreleased reopens empty", () => {
    const stamped = stampUnreleased(CHANGELOG, "5.0.0-beta.54", "2026-09-11")
    expect(stamped).toContain("## [5.0.0-beta.54] - 2026-09-11")
    expect(stamped.indexOf("## [Unreleased]")).toBeLessThan(stamped.indexOf("## [5.0.0-beta.54]"))
    expect(extractReleaseNotes(stamped, "5.0.0-beta.54")).toBe("### Added\n\n- a new thing")
  })

  test("#given an empty Unreleased section #when stamped #then it refuses", () => {
    const empty = "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n- old\n"
    expect(() => stampUnreleased(empty, "2.0.0", "2026-09-11")).toThrow(/empty/)
  })

  test("#given the version already released #when stamped again #then it refuses", () => {
    expect(() => stampUnreleased(CHANGELOG, "5.0.0-beta.53", "2026-09-11")).toThrow(/already contains/)
  })

  test("#given no Unreleased heading #when stamped #then it refuses", () => {
    expect(() => stampUnreleased("# Changelog\n", "1.0.0", "2026-09-11")).toThrow(/no ## \[Unreleased\]/)
  })

  test("#given an impossible date #when stamped #then it refuses", () => {
    expect(() => stampUnreleased(CHANGELOG, "9.9.9", "2026-02-30")).toThrow(/not a real calendar date/)
    expect(() => assertUtcDate("2026-9-1")).toThrow(/YYYY-MM-DD/)
  })
})

describe("extractReleaseNotes", () => {
  test("#given a released section #when extracted #then only its body is returned", () => {
    expect(extractReleaseNotes(CHANGELOG, "5.0.0-beta.53")).toBe("- an older thing")
  })

  test("#given a missing version #when extracted #then it fails closed", () => {
    expect(() => extractReleaseNotes(CHANGELOG, "9.9.9")).toThrow(/no section/)
  })

  test("#given a duplicated section #when extracted #then it fails closed", () => {
    const dup = CHANGELOG + "\n## [5.0.0-beta.53] - 2026-09-10\n\n- dupe\n"
    expect(() => extractReleaseNotes(dup, "5.0.0-beta.53")).toThrow(/2 sections/)
  })

  test("#given an empty released section #when extracted #then it fails closed", () => {
    const blank = "# Changelog\n\n## [1.0.0] - 2026-01-01\n\n## [0.9.0] - 2025-12-01\n\n- old\n"
    expect(() => extractReleaseNotes(blank, "1.0.0")).toThrow(/empty/)
  })
})

describe("composeReleaseBody", () => {
  test("#given notes, contributors and a footer #when composed #then order is notes, contributors, footer", () => {
    const body = composeReleaseBody(
      "### Added\n\n- thing",
      "**Thanks:**\n- @someone",
      "\`\`\`bash\nnpm i -g omo-ai@beta\n\`\`\`",
    )
    expect(body.indexOf("- thing")).toBeLessThan(body.indexOf("@someone"))
    expect(body.indexOf("@someone")).toBeLessThan(body.indexOf("npm i -g"))
    expect(body.endsWith("\n")).toBe(true)
  })

  test("#given no contributors #when composed #then no blank block is inserted", () => {
    expect(composeReleaseBody("notes", "", "footer")).toBe("notes\n\nfooter\n")
  })

  test("#given fragment text citing a private-shaped reference #when composed #then it is neutralized and public ones stay", () => {
    const body = composeReleaseBody(
      "- fixed (acme-svc#9, senpi#6412)",
      "- @a: thanks (acme-svc#9)",
      "```bash\nbun add -g omo-ai\n```",
    )
    expect(body).toContain("- fixed (tracked internally, senpi#6412)")
    expect(body).toContain("- @a: thanks (tracked internally)")
    expect(body).not.toContain("acme-svc")
    expect(body).toContain("bun add -g omo-ai")
  })

  test("#given fragment and contributor text with private GitHub URLs #when composed #then no private URL survives and public ones stay", () => {
    const publicLink = "[omo#12](https://github.com/code-yeongyu/oh-my-openagent/pull/12)"
    const body = composeReleaseBody(
      "- fixed [acme-svc#628](https://github.com/acme-org/acme-svc/issues/628) and https://github.com/acme-org/acme-svc/pull/9. " +
        publicLink,
      "- @a: see https://github.com/acme-org/acme-svc/commit/abc1234",
      "footer",
    )
    expect(body).toBe(
      "- fixed tracked internally and tracked internally. " +
        publicLink +
        "\n\n- @a: see tracked internally\n\nfooter\n",
    )
    expect(body).not.toContain("acme-")
  })
})

describe("installFooter", () => {
  test("#given a stable version #then the footer installs the bare package", async () => {
    const { installFooter } = await import("./print-release-notes")
    expect(installFooter("5.0.0")).toContain("bun add -g omo-ai\n")
    expect(installFooter("5.0.0")).not.toContain("@beta")
  })

  test("#given a prerelease version #then the footer installs the beta tag", async () => {
    const { installFooter } = await import("./print-release-notes")
    expect(installFooter("5.0.0-beta.91")).toContain("bun add -g omo-ai@beta")
  })
})

describe("neutralizeCrossRepoReferences URL boundaries", () => {
  const PRIVATE = "https://github.com/acme-org/acme-svc/pull/9"
  test.each(["_", "-", ".", "/", "a"])(
    "#given a private https URL right after %p #when neutralized #then it is replaced",
    (lead) => {
      expect(neutralizeCrossRepoReferences("x" + lead + PRIVATE)).toStrictEqual("x" + lead + "tracked internally")
    },
  )

  test("#given a scheme-less private URL after a space #when neutralized #then it is replaced", () => {
    expect(neutralizeCrossRepoReferences("see github.com/acme-org/acme-svc now")).toStrictEqual(
      "see tracked internally now",
    )
  })

  test("#given a scheme-less private URL inside another URL path #when neutralized #then the whole URL is replaced", () => {
    expect(neutralizeCrossRepoReferences("see https://example.com/github.com/acme-org/acme-svc now")).toStrictEqual(
      "see tracked internally now",
    )
    expect(
      neutralizeCrossRepoReferences("see web.archive.org/web/2024/github.com/acme-org/acme-svc now"),
    ).toStrictEqual("see web.archive.org/web/2024/tracked internally now")
  })

  test("#given a public GitHub path nested in another URL path #when neutralized #then it is unchanged", () => {
    const text =
      "https://example.com/github.com/code-yeongyu/senpi and web.archive.org/web/2024/github.com/code-yeongyu/senpi"
    expect(neutralizeCrossRepoReferences(text)).toStrictEqual(text)
  })

  test("#given a host merely ending in github.com #when neutralized #then it is not treated as GitHub", () => {
    const text = "https://notgithub.com/acme-org/acme-svc and notgithub.com/acme-org/acme-svc"
    expect(neutralizeCrossRepoReferences(text)).toStrictEqual(text)
  })

  test.each([
    "https://github.com/settings/tokens",
    "https://github.com/apps/renovate",
    "https://github.com/sponsors/someone",
    "https://github.com/orgs/acme-org",
    "https://github.com/marketplace/actions",
    "https://github.com/features/actions",
    "https://github.com/topics/typescript",
    "https://github.com/notifications/subscriptions",
    "https://github.com/login/device",
    "https://github.com/new/import",
    "[tokens](https://github.com/settings/tokens)",
    "<https://github.com/apps/renovate>",
  ])("#given a reserved GitHub page %p #when neutralized #then it is unchanged", (text) => {
    expect(neutralizeCrossRepoReferences(text)).toStrictEqual(text)
  })

  test("#given a public clone URL with .git #when neutralized #then it is unchanged", () => {
    const text = "git clone https://github.com/code-yeongyu/oh-my-openagent.git"
    expect(neutralizeCrossRepoReferences(text)).toStrictEqual(text)
  })

  test("#given a private clone URL with .git #when neutralized #then it is replaced", () => {
    expect(neutralizeCrossRepoReferences("git clone https://github.com/acme-org/acme-svc.git")).toStrictEqual(
      "git clone tracked internally",
    )
  })
})
describe("neutralizeCrossRepoReferences API, raw and nested URLs", () => {
  test.each([
    ["https://api.github.com/repos/acme-org/acme-svc/pulls/1", "tracked internally"],
    ["see https://api.github.com/repos/acme-org/acme-svc now", "see tracked internally now"],
    ["https://raw.githubusercontent.com/acme-org/acme-svc/main/README.md", "tracked internally"],
    ["[file](https://raw.githubusercontent.com/acme-org/acme-svc/main/a.md)", "tracked internally"],
    ["<https://api.github.com/repos/acme-org/acme-svc/issues/2>", "tracked internally"],
  ])("#given a private API or raw URL %p #when neutralized #then it is replaced", (text, expected) => {
    expect(neutralizeCrossRepoReferences(text)).toStrictEqual(expected)
  })

  test.each([
    "https://api.github.com/repos/code-yeongyu/oh-my-openagent/pulls/1",
    "https://raw.githubusercontent.com/code-yeongyu/senpi/main/README.md",
  ])("#given a public API or raw URL %p #when neutralized #then it is unchanged", (text) => {
    expect(neutralizeCrossRepoReferences(text)).toStrictEqual(text)
  })

  test("#given an API URL whose owner is a reserved web path #when neutralized #then it is still replaced", () => {
    expect(neutralizeCrossRepoReferences("https://api.github.com/repos/settings/acme-svc")).toStrictEqual(
      "tracked internally",
    )
  })

  test.each([
    "https://github.com/codespaces/new",
    "https://github.com/users/u/projects/3",
    "https://github.com/enterprises/acme/settings",
    "https://github.com/account/billing",
    "https://github.com/dashboard/feed",
    "https://github.com/pulls/assigned",
    "https://github.com/issues/created",
    "https://github.com/pulls",
  ])("#given a non-owner GitHub page %p #when neutralized #then it is unchanged", (text) => {
    expect(neutralizeCrossRepoReferences(text)).toStrictEqual(text)
  })

  test("#given a private URL nested in an archive URL #when neutralized #then the whole URL is replaced", () => {
    expect(
      neutralizeCrossRepoReferences("see https://web.archive.org/web/2024/https://github.com/acme-org/acme-svc now"),
    ).toStrictEqual("see tracked internally now")
  })

  test("#given a private URL nested in a markdown link target #when neutralized #then the whole link is replaced", () => {
    expect(
      neutralizeCrossRepoReferences("a [old](https://web.archive.org/web/2024/https://github.com/acme-org/acme-svc) b"),
    ).toStrictEqual("a tracked internally b")
  })

  test("#given a public URL nested in an archive URL #when neutralized #then it is unchanged", () => {
    const text = "[old](https://web.archive.org/web/2024/https://github.com/code-yeongyu/senpi) x"
    expect(neutralizeCrossRepoReferences(text)).toStrictEqual(text)
  })

  test("#given a non-GitHub markdown link with a private reference in its text #when neutralized #then the text is neutralized", () => {
    expect(neutralizeCrossRepoReferences("[acme-org/acme-svc#3](https://example.com/x)")).toStrictEqual(
      "[tracked internally](https://example.com/x)",
    )
  })
})

describe("neutralizeCrossRepoReferences review-round findings", () => {
  test("#given a non-GitHub URL carrying a private owner/repo#N #when neutralized #then the whole URL is replaced", () => {
    expect(neutralizeCrossRepoReferences("see https://example.com/x?r=acme-org/acme-svc#3 now")).toStrictEqual(
      "see tracked internally now",
    )
  })

  test("#given a non-GitHub markdown link carrying a scheme-less private GitHub path #when neutralized #then the whole link is replaced", () => {
    expect(neutralizeCrossRepoReferences("a [x](https://example.com/?u=github.com/acme-org/acme-svc) b")).toStrictEqual(
      "a tracked internally b",
    )
  })

  test("#given a private URL nested in a kept public GitHub URL #when neutralized #then the whole URL is replaced", () => {
    expect(
      neutralizeCrossRepoReferences(
        "see https://github.com/code-yeongyu/senpi/blob/main/x?ref=https://github.com/acme-org/acme-svc now",
      ),
    ).toStrictEqual("see tracked internally now")
  })

  test("#given a codeload host naming a private repo #when neutralized #then it is replaced", () => {
    expect(
      neutralizeCrossRepoReferences(
        "get https://codeload.github.com/acme-org/acme-svc/zip/main and codeload.github.com/acme-org/acme-svc/zip/main",
      ),
    ).toStrictEqual("get tracked internally and tracked internally")
  })

  test("#given a codeload host naming a public repo #when neutralized #then it is unchanged", () => {
    const text = "https://codeload.github.com/code-yeongyu/senpi/zip/main"
    expect(neutralizeCrossRepoReferences(text)).toStrictEqual(text)
  })
})

describe("neutralizeCrossRepoReferences invariant", () => {
  const PRIVATE_INPUTS = [
    "[a](https://github.com/acme-org/acme-svc/issues/1)",
    "[a](github.com/acme-org/acme-svc)",
    "[a](www.github.com/acme-org/acme-svc)",
    "[a](https://example.com/?r=acme-org/acme-svc#3)",
    "[a](https://example.com/?u=https://github.com/acme-org/acme-svc)",
    "[a](https://example.com/?u=github.com/acme-org/acme-svc)",
    "[a](https://github.com/code-yeongyu/senpi/blob/main/x?ref=https://github.com/acme-org/acme-svc)",
    "[acme-org/acme-svc#3](https://github.com/acme-org/acme-svc)",
    "<https://github.com/acme-org/acme-svc>",
    "<github.com/acme-org/acme-svc/pull/2>",
    "<https://example.com/?r=acme-org/acme-svc#3>",
    "<https://api.github.com/repos/acme-org/acme-svc/pulls/1>",
    "https://github.com/acme-org/acme-svc",
    "http://github.com/acme-org/acme-svc/pull/9.",
    "github.com/acme-org/acme-svc",
    "www.github.com/acme-org/acme-svc/issues/4",
    "HTTPS://GITHUB.COM/ACME-ORG/ACME-SVC/pull/1",
    "Github.com/Acme-Org/Acme-Svc",
    "https://api.github.com/repos/acme-org/acme-svc/issues/5",
    "api.github.com/repos/acme-org/acme-svc",
    "https://raw.githubusercontent.com/acme-org/acme-svc/main/a.md",
    "raw.githubusercontent.com/acme-org/acme-svc/main/a.md",
    "https://codeload.github.com/acme-org/acme-svc/zip/main",
    "https://gist.github.com/acme-org/abc123",
    "https://github.com/code-yeongyu/senpi/blob/main/x?ref=https://github.com/acme-org/acme-svc",
    "https://github.com/code-yeongyu/senpi?u=github.com/acme-org/acme-svc",
    "https://example.com/redirect?to=https://github.com/acme-org/acme-svc",
    "https://web.archive.org/web/2024/https://github.com/acme-org/acme-svc",
    "https://web.archive.org/web/2024/github.com/acme-org/acme-svc",
    "web.archive.org/web/2024/github.com/acme-org/acme-svc",
    "https://example.com/github.com/acme-org/acme-svc",
    "https://example.com/a/b/raw.githubusercontent.com/acme-org/acme-svc/main/x",
    "https://example.com/?r=acme-svc#3",
    "https://example.com/?see=acme-org/acme-svc#3",
    "git clone https://github.com/acme-org/acme-svc.git",
    "git clone git@github.com:acme-org/acme-svc.git",
    "git clone ssh://git@github.com/acme-org/acme-svc.git",
    "https://api.github.com/repos/settings/acme-svc",
    "//github.com/acme-org/acme-svc",
    "fixed acme-svc#9 and acme-org/acme-svc#10 (see https://github.com/acme-org/acme-svc/pull/9).",
    "x_https://github.com/acme-org/acme-svc/pull/9",
    "[a](https://example.com/a_(b)?r=https://github.com/acme-org/acme-svc)",
    "see https://github.com/acme-org/acme-svc#readme, [x](https://github.com/code-yeongyu/senpi) ok",
    "_github.com/acme-org/acme-svc_",
    "*github.com/acme-org/acme-svc*",
    "**github.com/acme-org/acme-svc**",
    "_acme-svc#3_",
    "https://github.com./acme-org/acme-svc",
    "github.com./acme-org/acme-svc",
    "https://example.com/?u=https%3A%2F%2Fgithub.com%2Facme-org%2Facme-svc",
    "https://example.com/?u=https%253A%252F%252Fgithub.com%252Facme-org%252Facme-svc",
    "https%3A%2F%2Fgithub.com%2Facme-org%2Facme-svc",
    "https://github.com/code-yeongyu/senpi/compare/main...acme-org:acme-svc:feat",
    "https://github.com/code-yeongyu/senpi/../../acme-org/acme-svc",
    "[a](https://github.com/code-yeongyu/senpi/compare/main...acme-org:acme-svc:feat)",
    "<https://github.com/code-yeongyu/senpi/../../acme-org/acme-svc>",
  ]

  test.each(PRIVATE_INPUTS)(
    "#given private-bearing input %p #when neutralized #then no private reference survives",
    (text) => {
      expect(findPrivateReferences(text)).toBe(true)
      expect(findPrivateReferences(neutralizeCrossRepoReferences(text))).toBe(false)
    },
  )

  const PUBLIC_INPUTS = [
    "[omo#12](https://github.com/code-yeongyu/oh-my-openagent/pull/12)",
    "<https://github.com/code-yeongyu/senpi/pull/4>",
    "https://github.com/code-yeongyu/senpi/blob/main/README.md?plain=1#L10",
    "HTTPS://GITHUB.COM/CODE-YEONGYU/SENPI/issues/1",
    "github.com/code-yeongyu/oh-my-opencode",
    "www.github.com/sisyphuslabs/doriterm/pull/3",
    "https://api.github.com/repos/code-yeongyu/lazycodex/pulls/2",
    "https://raw.githubusercontent.com/code-yeongyu/senpi/main/a.md",
    "https://codeload.github.com/code-yeongyu/oh-my-openagent/zip/main",
    "git clone https://github.com/code-yeongyu/oh-my-openagent.git",
    "git clone git@github.com:code-yeongyu/senpi.git",
    "https://github.com/settings/tokens",
    "[t](https://github.com/apps/renovate)",
    "https://github.com/code-yeongyu/senpi/pull/12#issuecomment-5",
    "https://example.com/docs?page=2",
    "[docs](https://example.com/guide)",
    "https://docs.github.com/en/actions",
    "https://web.archive.org/web/2024/https://github.com/code-yeongyu/senpi",
    "https://example.com/github.com/code-yeongyu/senpi",
    "https://web.archive.org/web/2024/github.com/code-yeongyu/senpi",
    "https://notgithub.com/acme-org/acme-svc",
    "fixed senpi#6412 and omo#12 and code-yeongyu/senpi#7 (PR#3, GH#4)",
    "plain text with no references at all.",
    "_github.com/code-yeongyu/senpi_",
    "**github.com/code-yeongyu/senpi**",
    "https://github.com./code-yeongyu/senpi",
    "https://example.com/?u=https%3A%2F%2Fgithub.com%2Fcode-yeongyu%2Fsenpi",
    "https://github.com/code-yeongyu/senpi/compare/main...code-yeongyu:senpi:feat",
    "see _senpi#3_ now",
  ]

  test.each(PUBLIC_INPUTS)("#given public-only input %p #when neutralized #then it is byte-identical", (text) => {
    expect(findPrivateReferences(text)).toBe(false)
    expect(neutralizeCrossRepoReferences(text)).toBe(text)
  })

  test("#given an unrelated mid-sentence mix #when neutralized #then only the private parts are replaced", () => {
    expect(
      neutralizeCrossRepoReferences(
        "a senpi#1 b acme-svc#2 c https://github.com/code-yeongyu/senpi d <https://github.com/acme-org/acme-svc> e",
      ),
    ).toBe("a senpi#1 b tracked internally c https://github.com/code-yeongyu/senpi d tracked internally e")
  })
})

describe("neutralizeCrossRepoReferences emphasis, encoding and following pairs", () => {
  test.each([
    ["_github.com/acme-org/acme-svc_", "_tracked internally_"],
    ["*github.com/acme-org/acme-svc*", "*tracked internally*"],
    ["**github.com/acme-org/acme-svc**", "**tracked internally**"],
    ["~~https://github.com/acme-org/acme-svc/pull/9~~", "~~tracked internally~~"],
    ["see _acme-svc#3_ now", "see _tracked internally_ now"],
    ["https://github.com./acme-org/acme-svc", "tracked internally"],
    ["github.com./acme-org/acme-svc", "tracked internally"],
    ["https://example.com/?u=https%3A%2F%2Fgithub.com%2Facme-org%2Facme-svc", "tracked internally"],
    ["https://example.com/?u=https%253A%252F%252Fgithub.com%252Facme-org%252Facme-svc", "tracked internally"],
    ["https%3A%2F%2Fgithub.com%2Facme-org%2Facme-svc", "tracked internally"],
    ["https://github.com/code-yeongyu/senpi/compare/main...acme-org:acme-svc:feat", "tracked internally"],
    ["see https://github.com/code-yeongyu/senpi/../../acme-org/acme-svc now", "see tracked internally now"],
    ["https://github.com/code-yeongyu/senpi/%2e%2e/%2e%2e/acme-org/acme-svc", "tracked internally"],
  ])("#given %p #when neutralized #then it becomes %p", (text, expected) => {
    expect(neutralizeCrossRepoReferences(text)).toStrictEqual(expected)
  })

  test.each([
    "_github.com/code-yeongyu/senpi_",
    "**github.com/code-yeongyu/senpi**",
    "https://github.com./code-yeongyu/senpi",
    "https://example.com/?u=https%3A%2F%2Fgithub.com%2Fcode-yeongyu%2Fsenpi",
    "https://github.com/code-yeongyu/senpi/compare/main...code-yeongyu:senpi:feat",
    "https://github.com/code-yeongyu/senpi/blob/main/a.ts#L1",
    "see _senpi#3_ now",
  ])("#given public variant %p #when neutralized #then it is byte-identical", (text) => {
    expect(findPrivateReferences(text)).toBe(false)
    expect(neutralizeCrossRepoReferences(text)).toBe(text)
  })
})

describe("neutralizeCrossRepoReferences performance", () => {
  test("#given 100k characters of a. #when neutralized #then it completes under one second", () => {
    const text = "a.".repeat(50_000)
    const started = performance.now()
    expect(neutralizeCrossRepoReferences(text)).toBe(text)
    expect(findPrivateReferences(text)).toBe(false)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  test("#given a GitHub host followed by 100k characters of a. #when neutralized #then it completes under one second", () => {
    const text = "https://github.com/code-yeongyu/senpi/" + "a.".repeat(50_000)
    const started = performance.now()
    neutralizeCrossRepoReferences(text)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
