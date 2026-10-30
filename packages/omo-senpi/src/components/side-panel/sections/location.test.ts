import { describe, expect, test } from "bun:test"

import { buildLocationRows } from "./location"
import type { PanelRow } from "../types"

const texts = (rows: readonly PanelRow[]): string[] => rows.map((row) => row.text)

describe("buildLocationRows", () => {
  test("#given a directory under home #when built #then home collapses to a tilde", () => {
    // given
    const location = { cwd: "/home/dev/_code/notwork" }

    // when
    const rows = texts(buildLocationRows(location, 40, "/home/dev"))

    // then
    expect(rows).toEqual(["~/_code/notwork"])
  })

  test("#given home itself #when built #then it renders as a bare tilde", () => {
    // given
    const location = { cwd: "/home/dev" }

    // when
    const rows = texts(buildLocationRows(location, 40, "/home/dev"))

    // then
    expect(rows).toEqual(["~"])
  })

  test("#given a sibling directory sharing the home prefix #when built #then the path is left intact", () => {
    // given
    const location = { cwd: "/home/developer/project" }

    // when
    const rows = texts(buildLocationRows(location, 40, "/home/dev"))

    // then
    expect(rows).toEqual(["/home/developer/project"])
  })

  test("#given a branch #when built #then it follows the directory", () => {
    // given
    const location = { cwd: "/srv/app", branch: "feat/side-panel" }

    // when
    const rows = texts(buildLocationRows(location, 40))

    // then
    expect(rows).toEqual(["/srv/app · feat/side-panel"])
  })

  test("#given an empty branch #when built #then no separator is rendered", () => {
    // given
    const location = { cwd: "/srv/app", branch: "" }

    // when
    const rows = texts(buildLocationRows(location, 40))

    // then
    expect(rows).toEqual(["/srv/app"])
  })

  test("#given a path longer than the column #when built #then the tail survives and the head is elided", () => {
    // given
    const location = { cwd: "/very/deep/nested/tree/of/directories/project" }

    // when
    const rows = texts(buildLocationRows(location, 20))

    // then
    expect(rows[0]).toHaveLength(20)
    expect(rows[0]?.startsWith("…")).toBe(true)
    expect(rows[0]?.endsWith("project")).toBe(true)
  })

  test("#given a branch that fills the column #when built #then the directory yields to the branch", () => {
    // given
    const location = { cwd: "/very/deep/nested/tree", branch: "release/2026-09-10-hotfix" }

    // when
    const rows = texts(buildLocationRows(location, 12))

    // then
    expect(rows[0]).toHaveLength(12)
    expect(rows[0]?.endsWith("hotfix")).toBe(true)
  })

  test("#given no width #when built #then nothing is rendered", () => {
    // given
    const location = { cwd: "/srv/app" }

    // when
    const rows = texts(buildLocationRows(location, 0))

    // then
    expect(rows).toEqual([])
  })
})
