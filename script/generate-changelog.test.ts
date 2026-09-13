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
})

describe("isExcludedReleaseNoteSubject", () => {
  test.each([
    ["feat(senpi): add team tools", true],
    ["fix(omo-senpi): persist member sidecar", true],
    ["feat(senpi-task): wire message-durability fallbacks", true],
    ["fix(pi-goal): correct goal parsing", true],
    ["feat(pi-webfetch): add fetch retries", true],
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
