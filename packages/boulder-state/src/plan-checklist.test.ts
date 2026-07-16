/// <reference path="../../../bun-test.d.ts" />

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { getPlanChecklist, parsePlanChecklist } from "./plan-checklist"

const cleanupRoots: string[] = []
const SCAFFOLD_PLAN_MARKDOWN = [
  "# Scaffold Parser Parity",
  "",
  "## Todos",
  "- [ ] 1. Implement checklist parser parity",
  "  - [ ] Nested acceptance detail",
  "- [x] 2. Preserve completed implementation rows",
  "- [ ] Missing numeric prefix must be ignored",
  "",
  "## Acceptance Criteria",
  "- [ ] Outside tracked sections must be ignored",
  "",
  "## Final verification wave",
  "- [ ] F1. Exercise the Codex Stop surface",
  "- [X] F2. Preserve completed final verification rows",
  "- [ ] 3. Wrong final-wave label must be ignored",
].join("\n")

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("parsePlanChecklist", () => {
  test("#given scaffold headings and canonical numbered rows #when parsed #then structured totals and next label match", () => {
    // given
    const markdown = SCAFFOLD_PLAN_MARKDOWN

    // when
    const checklist = parsePlanChecklist(markdown)

    // then
    expect(checklist).toEqual({
      completed: 2,
      remaining: 2,
      total: 4,
      nextTaskLabel: "1. Implement checklist parser parity",
    })
  })

  test("#given no counted sections #when parsed #then all top-level checkboxes are counted", () => {
    // given
    const markdown = ["# Plan", "- [ ] First", "- [x] Done", "  - [ ] Nested"].join("\n")

    // when
    const checklist = parsePlanChecklist(markdown)

    // then
    expect(checklist).toEqual({ completed: 1, remaining: 1, total: 2, nextTaskLabel: "First" })
  })

  test("#given a heading-free legacy star checklist #when parsed #then fallback behavior is preserved", () => {
    // given
    const markdown = ["# Plan", "* [ ] First", "* [x] Done", "  * [ ] Nested"].join("\n")

    // when
    const checklist = parsePlanChecklist(markdown)

    // then
    expect(checklist).toEqual({ completed: 1, remaining: 1, total: 2, nextTaskLabel: "First" })
  })

  test("#given completed implementation rows and pending final verifier #when parsed #then final verifier is next", () => {
    // given
    const markdown = [
      "## Todos",
      "- [x] 1. Implementation complete",
      "## Final verification wave",
      "- [ ] F1. Verify the result",
    ].join("\n")

    // when
    const checklist = parsePlanChecklist(markdown)

    // then
    expect(checklist).toEqual({ completed: 1, remaining: 1, total: 2, nextTaskLabel: "F1. Verify the result" })
  })

  test("#given noncanonical structured rows #when parsed #then only exact positive-number grammar is counted", () => {
    // given
    const markdown = [
      "## Todos",
      "- [ ] 0. Zero is invalid",
      "- [ ] 01. Leading zero is invalid",
      "* [ ] 2. Star marker is invalid",
      "-[ ] 3. Missing spaces are invalid",
      "- [ ] 4. Canonical implementation",
      "## Final verification wave",
      "- [ ] F0. Zero final verifier is invalid",
      "- [ ] F01. Leading zero final verifier is invalid",
      "- [x] F2. Canonical final verifier",
    ].join("\n")

    // when
    const checklist = parsePlanChecklist(markdown)

    // then
    expect(checklist).toEqual({
      completed: 1,
      remaining: 1,
      total: 2,
      nextTaskLabel: "4. Canonical implementation",
    })
  })

  test("#given fenced examples and a higher-level heading #when parsed #then section scope excludes them", () => {
    // given
    const markdown = [
      "## Todos",
      "- [ ] 1. Counted implementation",
      "```md",
      "- [ ] 2. Fenced example",
      "```",
      "# Appendix",
      "- [ ] 3. Appendix checkbox",
      "## Final verification wave",
      "- [x] F1. Counted verifier",
    ].join("\n")

    // when
    const checklist = parsePlanChecklist(markdown)

    // then
    expect(checklist).toEqual({
      completed: 1,
      remaining: 1,
      total: 2,
      nextTaskLabel: "1. Counted implementation",
    })
  })

  test("#given a four-backtick fence containing triple-backtick examples #when parsed #then shorter fences do not close it", () => {
    // given
    const markdown = [
      "## Todos",
      "- [x] 1. Counted implementation",
      "````md",
      "```ts",
      "- [ ] 2. Fenced example",
      "```",
      "````",
      "## Final verification wave",
      "- [ ] F1. Counted verifier",
    ].join("\n")

    // when
    const checklist = parsePlanChecklist(markdown)

    // then
    expect(checklist).toEqual({
      completed: 1,
      remaining: 1,
      total: 2,
      nextTaskLabel: "F1. Counted verifier",
    })
  })
})

describe("getPlanChecklist", () => {
  test("#given missing plan path #when checklist is read #then empty checklist is returned", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "boulder-plan-checklist-"))
    cleanupRoots.push(directory)
    mkdirSync(directory, { recursive: true })

    // when
    const checklist = getPlanChecklist(join(directory, "missing.md"))

    // then
    expect(checklist).toEqual({ completed: 0, remaining: 0, total: 0, nextTaskLabel: null })
  })

  test("#given complete plan #when checklist is read #then no next task is returned", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "boulder-plan-checklist-"))
    cleanupRoots.push(directory)
    const planPath = join(directory, "plan.md")
    writeFileSync(
      planPath,
      "## Todos\n- [x] 1. First\n- [X] 2. Second\n## Final verification wave\n- [x] F1. Final\n",
    )

    // when
    const checklist = getPlanChecklist(planPath)

    // then
    expect(checklist).toEqual({ completed: 3, remaining: 0, total: 3, nextTaskLabel: null })
  })
})
