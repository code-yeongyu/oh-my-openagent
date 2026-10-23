import { describe, expect, test } from "bun:test"

import { selectRecallCandidates, type RecallDocument } from "@oh-my-opencode/memory-core"

import { selectWithProjectSeats, type ProjectRecallCorpus } from "./project-recall-seats"

const QUERY = "kubernetes rollout canary"

function note(path: string, description: string, body = description): RecallDocument {
  return { path, description, body }
}

function filler(prefix: string, count: number, text: string): RecallDocument[] {
  return Array.from({ length: count }, (_, index) => note(`${prefix}/note-${index}.md`, `${text} ${index}`))
}

function project(id: string, documents: readonly RecallDocument[], touchedPath?: string): ProjectRecallCorpus {
  return { identityId: id, documents, ...(touchedPath === undefined ? {} : { touchedPath }) }
}

function rank(queries: readonly string[], maxItems: number) {
  return (documents: readonly RecallDocument[], extraQueries: readonly string[]) =>
    selectRecallCandidates(documents, [...queries, ...extraQueries], { maxItems, surfaced: new Set() })
}

describe("selectWithProjectSeats (#10044)", () => {
  test("#given 150 own notes and a 60-note project #when ranked #then the own candidates are exactly the own-only ranking, not one shifted by a merged corpus", () => {
    // given - merged, the 210 documents would cross the 200-document strategy switch and reweight every term.
    const own = filler("own", 150, "kubernetes rollout canary steps")
    const projects = [project("child-1234abcd", filler("child", 60, "kubernetes rollout canary checklist"))]
    const maxItems = 4

    // when
    const alone = selectWithProjectSeats(own, [], maxItems, rank([QUERY], maxItems))
    const withProject = selectWithProjectSeats(own, projects, maxItems, rank([QUERY], maxItems))

    // then
    const ownPart = withProject.filter((candidate) => !candidate.path.startsWith("@project/"))
    expect(ownPart).toEqual(alone.slice(0, ownPart.length))
    expect(ownPart.length).toBe(maxItems - Math.ceil(maxItems / 2))
    expect(withProject.some((candidate) => candidate.path.startsWith("@project/"))).toBe(true)
  })

  test("#given 800 own notes that all match better #when a touched project holds one matching note #then it still gets its reserved seat", () => {
    // given
    const own = filler("own", 800, "kubernetes rollout canary kubernetes rollout canary")
    const projects = [project("child-1234abcd", [note("deploy.md", "deployment journal", `${"unrelated words about the weekly sync ".repeat(60)} kubernetes rollout canary`)])]

    // when
    const selected = selectWithProjectSeats(own, projects, 2, rank([QUERY], 2))

    // then
    expect(selected).toHaveLength(2)
    expect(selected.map((candidate) => candidate.path)).toContain("@project/child-1234abcd/deploy.md")
  })

  test("#given two equally matching project notes #when one names the touched file #then that note ranks first in its project", () => {
    // given
    const projects = [project("child-1234abcd", [
      note("a-general.md", "canary rollout notes"),
      note("b-scheduler.md", "canary rollout notes", "canary rollout notes for packages/senpi-task/src/dag/scheduler.ts"),
    ], "packages/senpi-task/src/dag/scheduler.ts")]

    // when
    const selected = selectWithProjectSeats([], projects, 2, rank(["canary rollout"], 2))

    // then
    expect(selected[0]?.path).toBe("@project/child-1234abcd/b-scheduler.md")
  })

  test("#given no project note matches #when ranked #then own notes take every seat, and the reverse when own is empty", () => {
    // given
    const own = filler("own", 5, "kubernetes rollout canary")
    const unrelated = [project("child-1234abcd", [note("cooking.md", "pasta recipes")])]
    const matching = [project("child-1234abcd", filler("child", 5, "kubernetes rollout canary"))]

    // when
    const ownOnly = selectWithProjectSeats(own, unrelated, 4, rank([QUERY], 4))
    const projectOnly = selectWithProjectSeats([], matching, 4, rank([QUERY], 4))

    // then
    expect(ownOnly).toHaveLength(4)
    expect(ownOnly.every((candidate) => !candidate.path.startsWith("@project/"))).toBe(true)
    expect(projectOnly).toHaveLength(4)
  })

  test("#given three touched projects and an own corpus #when ranked #then each corpus is ranked exactly once, on its own documents", () => {
    // given
    const own = filler("own", 800, "kubernetes cluster notes")
    const projects = ["a", "b", "c"].map((name) => project(`${name}-1234abcd`, filler(name, 200, "kubernetes rollout canary")))
    const calls: number[] = []

    // when
    selectWithProjectSeats(own, projects, 2, (documents, extraQueries) => {
      calls.push(documents.length)
      return rank([QUERY], 2)(documents, extraQueries)
    })

    // then - four bounded passes, never a merged 1,400-document corpus.
    expect(calls).toEqual([800, 200, 200, 200])
  })
})
