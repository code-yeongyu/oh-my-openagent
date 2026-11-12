import { describe, expect, test } from "bun:test"
import {
  assertUtcDate,
  composeReleaseBody,
  extractReleaseNotes,
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

  test("#given a scheme-less private URL inside another URL path #when neutralized #then it is untouched", () => {
    const text = "https://example.com/github.com/acme-org/acme-svc"
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
