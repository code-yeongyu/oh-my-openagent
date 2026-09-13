import { describe, expect, test } from "bun:test"
import {
  assertUtcDate,
  composeReleaseBody,
  extractReleaseNotes,
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
    const body = composeReleaseBody("### Added\n\n- thing", "**Thanks:**\n- @someone", "\`\`\`bash\nnpm i -g omo-ai@beta\n\`\`\`")
    expect(body.indexOf("- thing")).toBeLessThan(body.indexOf("@someone"))
    expect(body.indexOf("@someone")).toBeLessThan(body.indexOf("npm i -g"))
    expect(body.endsWith("\n")).toBe(true)
  })

  test("#given no contributors #when composed #then no blank block is inserted", () => {
    expect(composeReleaseBody("notes", "", "footer")).toBe("notes\n\nfooter\n")
  })
})
