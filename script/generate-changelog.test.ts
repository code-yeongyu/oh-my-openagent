/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { isExcludedReleaseNoteSubject } from "./generate-changelog"

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
    ["fix(codex): refresh codegraph runtime gate", false],
  ])("#given subject %p #when exclusion is checked #then excluded is %p", (subject, expected) => {
    // given / when / then
    expect(isExcludedReleaseNoteSubject(subject)).toBe(expected)
  })
})
