/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { isCommunityContributor, isExcludedReleaseNoteSubject, selectPreviousReleaseTag } from "./generate-changelog"

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

import { formatCommitNotes, formatContributorNotes, neutralizeCrossRepoReferences } from "./generate-changelog"

describe("neutralizeCrossRepoReferences", () => {
  test("#given a reference to a non-public repo #when neutralized #then it reads tracked internally", () => {
    expect(neutralizeCrossRepoReferences("fix: handle x (x-y#12)")).toBe("fix: handle x (tracked internally)")
  })

  test("#given public, bare and PR references #when neutralized #then they are unchanged", () => {
    for (const text of ["senpi#6412", "code-yeongyu/senpi#1", "#123", "PR #123", "fix: thing (#123)"]) {
      expect(neutralizeCrossRepoReferences(text)).toBe(text)
    }
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
