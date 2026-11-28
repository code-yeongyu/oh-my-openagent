/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  formatCommitNotes,
  formatContributorNotes,
  isCommunityContributor,
  isExcludedReleaseNoteSubject,
  neutralizeCrossRepoReferences,
  selectPreviousReleaseTag,
} from "./generate-changelog"

describe("selectPreviousReleaseTag", () => {
  test("#given a beta target #when releases span channels #then the preceding beta is selected", () => {
    // given
    const tags = ["release-notes", "v5.0.0", "v5.0.0-rc.1", "v5.0.0-beta.8", "v5.0.0-beta.7", "v4.19.4"]

    // when
    const previous = selectPreviousReleaseTag("5.0.0-beta.9", tags)

    // then
    expect(previous).toBe("v5.0.0-beta.8")
  })

  test("#given a stable target #when releases include prereleases #then the latest preceding stable is selected", () => {
    // given
    const tags = ["v5.1.0-beta.1", "v5.0.0", "v5.0.0-beta.8", "v4.19.4"]

    // when
    const previous = selectPreviousReleaseTag("5.0.1", tags)

    // then
    expect(previous).toBe("v5.0.0")
  })

  test("#given a first stable target #when only its own prereleases and an older stable precede it #then its latest prerelease is selected", () => {
    // given
    const tags = ["v5.1.0-beta.1", "v5.0.0-beta.90", "v5.0.0-beta.89", "v4.19.4", "v4.19.3"]

    // when
    const previous = selectPreviousReleaseTag("5.0.0", tags)

    // then
    expect(previous).toBe("v5.0.0-beta.90")
  })

  test("#given a stable target #when another version's prerelease is the newest lower release #then that prerelease is not selected", () => {
    // given
    const tags = ["v5.0.1-beta.3", "v5.0.0", "v5.0.0-beta.90"]

    // when
    const previous = selectPreviousReleaseTag("5.1.0", tags)

    // then
    expect(previous).toBe("v5.0.0")
  })
})

describe("isExcludedReleaseNoteSubject", () => {
  test.each([
    ["feat(senpi): add team tools", true],
    ["fix(omo-senpi): persist member sidecar", true],
    ["feat(senpi-task): wire message-durability fallbacks", true],
    ["feat: improve senpi installer", true],
    ["Merge pull request #5932 from code-yeongyu/code-yeongyu/senpi-task-w3-engine", true],
    ["chore: bump internal tooling", true],
    ["test: add coverage", true],
    ["ci: tighten workflow", true],
    ["feat(api): expose new endpoint", false],
    ["fix(opencode): keep pinned model order", false],
    ["feat(cli): gate install platforms", false],
    ["fix(codex): refresh lsp runtime gate", false],
  ])("#given subject %p #when exclusion is checked #then excluded is %p", (subject, expected) => {
    // given / when / then
    expect(isExcludedReleaseNoteSubject(subject)).toBe(expected)
  })
})

describe("isCommunityContributor", () => {
  test("#given the release automation identity #when the footer is built #then it is not thanked as a community contributor", () => {
    // given
    const automation = "sisyphus-dev-ai"

    // when
    const credited = isCommunityContributor(automation)

    // then
    expect(credited).toBe(false)
  })

  test("#given maintainers and CI identities #when the footer is built #then none of them are credited", () => {
    for (const login of ["code-yeongyu", "actions-user", "github-actions[bot]"]) {
      expect(isCommunityContributor(login), `${login} must not be credited`).toBe(false)
    }
  })

  test("#given any other bot account #when the footer is built #then it is not credited", () => {
    expect(isCommunityContributor("dependabot[bot]")).toBe(false)
    expect(isCommunityContributor("renovate[bot]")).toBe(false)
  })

  test("#given a genuine outside contributor #when the footer is built #then they are credited", () => {
    expect(isCommunityContributor("minpeter")).toBe(true)
  })
})

describe("neutralizeCrossRepoReferences", () => {
  test("#given a reference to a non-public repo #when neutralized #then it reads tracked internally", () => {
    expect(neutralizeCrossRepoReferences("fix: handle x (x-y#12)")).toBe("fix: handle x (tracked internally)")
  })

  test("#given public, bare and PR references #when neutralized #then they are unchanged", () => {
    for (const text of ["senpi#6412", "code-yeongyu/senpi#1", "#123", "PR #123", "fix: thing (#123)"]) {
      expect(neutralizeCrossRepoReferences(text)).toBe(text)
    }
  })

  test("#given a markdown link to a private repo #when neutralized #then the whole link is replaced", () => {
    expect(neutralizeCrossRepoReferences("see [x-svc#628](https://github.com/acme-org/acme-svc/issues/628) now")).toBe(
      "see tracked internally now",
    )
    for (const kind of ["issues", "pull", "commit", "compare"]) {
      const url = "https://github.com/acme-org/acme-svc/" + kind + "/1"
      expect(neutralizeCrossRepoReferences("[t](" + url + ")")).toBe("tracked internally")
      expect(neutralizeCrossRepoReferences("a " + url + ".")).toBe("a tracked internally.")
    }
  })

  test("#given public GitHub URLs #when neutralized #then they stay byte-identical", () => {
    for (const text of [
      "[omo#1](https://github.com/code-yeongyu/oh-my-openagent/pull/1)",
      "https://github.com/code-yeongyu/senpi/issues/42#issuecomment-1",
      "https://github.com/sisyphuslabs/doriterm/compare/v1...v2",
    ]) {
      expect(neutralizeCrossRepoReferences(text)).toBe(text)
    }
  })

  test("#given a public URL whose link text cites a private reference #when neutralized #then only the text is neutralized", () => {
    expect(neutralizeCrossRepoReferences("[acme-svc#9](https://github.com/code-yeongyu/senpi/pull/9)")).toBe(
      "[tracked internally](https://github.com/code-yeongyu/senpi/pull/9)",
    )
  })

  test("#given an owner-qualified reference #when the owner is not allowlisted #then it is neutralized", () => {
    expect(neutralizeCrossRepoReferences("otherorg/senpi#1")).toBe("tracked internally")
    expect(neutralizeCrossRepoReferences("https://github.com/otherorg/senpi/pull/1")).toBe("tracked internally")
    for (const text of ["code-yeongyu/lazycodex#3", "sisyphuslabs/doriterm#4", "code-yeongyu/oh-my-opencode#5"]) {
      expect(neutralizeCrossRepoReferences(text)).toBe(text)
    }
  })

  test("#given same-repo shorthand and non-repo tokens #when neutralized #then the text is untouched", () => {
    for (const text of ["PR#123", "GH#123", "post-#12858", "Issue#4", "issues#5", "v1.#2"]) {
      expect(neutralizeCrossRepoReferences(text)).toBe(text)
    }
  })

  test("#given a public third-party reference #when neutralized #then it is neutralized by design (unknown owner/repo)", () => {
    expect(neutralizeCrossRepoReferences("fix (SawyerHood/dev-browser#146)")).toBe("fix (tracked internally)")
    expect(neutralizeCrossRepoReferences("https://github.com/SawyerHood/dev-browser/issues/146")).toBe(
      "tracked internally",
    )
  })

  test("#given private URLs in commit subjects and contributor titles #when notes are built #then they are neutralized", () => {
    expect(formatCommitNotes("abc1234 fix: x (https://github.com/acme-org/acme-svc/pull/9)")).toStrictEqual([
      "- abc1234 fix: x (tracked internally)",
    ])
    const compare = JSON.stringify({
      login: "minpeter",
      message: "fix: [a](https://github.com/acme-org/acme-svc/issues/1)",
    })
    expect(formatContributorNotes(compare)).toStrictEqual([
      "",
      "**Thank you to 1 community contributor:**",
      "- @minpeter:",
      "  - fix: tracked internally",
    ])
  })

  test("#given any GitHub URL form to a non-allowlisted repo #when neutralized #then it is replaced", () => {
    for (const url of [
      "https://github.com/acme-org/acme-svc",
      "https://github.com/acme-org/acme-svc/",
      "https://github.com/acme-org/acme-svc/blob/main/README.md#L3",
      "https://github.com/acme-org/acme-svc/tree/main/src",
      "https://github.com/acme-org/acme-svc/discussions/4",
      "https://github.com/acme-org/acme-svc/releases/tag/v1.0.0",
      "https://github.com/acme-org/acme-svc?tab=readme",
      "https://www.github.com/acme-org/acme-svc/pull/9",
      "https://GitHub.com/acme-org/acme-svc/pull/9",
      "http://GITHUB.COM/Acme-Org/Acme-Svc",
      "github.com/acme-org/acme-svc",
      "www.github.com/acme-org/acme-svc/pull/9",
    ]) {
      expect(neutralizeCrossRepoReferences("see " + url + " now")).toBe("see tracked internally now")
      expect(neutralizeCrossRepoReferences("see " + url + ".")).toBe("see tracked internally.")
      expect(neutralizeCrossRepoReferences("[x](" + url + ")")).toBe("tracked internally")
    }
  })

  test("#given any GitHub URL form to an allowlisted repo #when neutralized #then it is byte-identical", () => {
    for (const url of [
      "https://github.com/code-yeongyu/senpi",
      "https://github.com/code-yeongyu/senpi/",
      "https://github.com/code-yeongyu/senpi/blob/main/README.md#L3",
      "https://github.com/code-yeongyu/senpi/tree/main/src",
      "https://github.com/code-yeongyu/senpi/discussions/4",
      "https://github.com/code-yeongyu/senpi/releases/tag/v1.0.0",
      "https://www.github.com/code-yeongyu/senpi/pull/9",
      "https://GitHub.com/Code-Yeongyu/Senpi/pull/9",
      "github.com/code-yeongyu/senpi",
      "www.github.com/sisyphuslabs/doriterm/pull/9",
      "<https://github.com/code-yeongyu/senpi/pull/9>",
    ]) {
      expect(neutralizeCrossRepoReferences("see " + url + " now")).toBe("see " + url + " now")
    }
  })

  test("#given a private autolink #when neutralized #then the angle brackets go too", () => {
    expect(neutralizeCrossRepoReferences("fix <https://github.com/acme-org/acme-svc/pull/9> done")).toBe(
      "fix tracked internally done",
    )
    expect(neutralizeCrossRepoReferences("<https://github.com/acme-org/acme-svc>")).toBe("tracked internally")
  })

  test("#given a host that only ends in github.com #when neutralized #then it is untouched", () => {
    expect(neutralizeCrossRepoReferences("https://notgithub.com/acme-org/acme-svc")).toBe(
      "https://notgithub.com/acme-org/acme-svc",
    )
  })
})

describe("release note builders", () => {
  test("#given a commit subject citing a private-shaped reference #when notes are built #then it is neutralized", () => {
    const notes = formatCommitNotes("abc1234 fix: tighten gate (acme-svc#9, omo#6412)\ndef5678 chore: skip me")
    expect(notes).toEqual(["- abc1234 fix: tighten gate (tracked internally, omo#6412)"])
  })

  test("#given a contributor title citing a private-shaped reference #when notes are built #then it is neutralized", () => {
    const compare = JSON.stringify({ login: "minpeter", message: "fix: thing (acme-svc#9)\n\nbody" })
    const notes = formatContributorNotes(compare)
    expect(notes).toContain("  - fix: thing (tracked internally)")
    expect(notes.join("\n")).not.toContain("acme-svc")
  })
})
