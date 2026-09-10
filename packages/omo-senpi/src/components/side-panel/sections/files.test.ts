import { describe, expect, test } from "bun:test"

import { mergeGitDeltas, parseNumstatZ, parsePorcelainZ } from "../git/parse"
import { buildFileRows } from "./files"

const STATUS =
  " D gone.txt\u0000R  renamed-new.txt\u0000renamed.txt\u0000 M tracked.txt\u0000M  with space.txt\u0000?? brand-new.txt\u0000"
const UNSTAGED = "0\t1\tgone.txt\u00002\t1\ttracked.txt\u0000"
const STAGED = "0\t0\t\u0000renamed.txt\u0000renamed-new.txt\u00001\t0\twith space.txt\u0000"

const status = () => ({
  root: "/repo",
  files: mergeGitDeltas(parsePorcelainZ(STATUS), parseNumstatZ(UNSTAGED), parseNumstatZ(STAGED)),
})

const texts = (rows: readonly { text: string }[]): string[] => rows.map((row) => row.text)

describe("buildFileRows", () => {
  test("#given a real working copy #when built #then every state renders with its columns and deltas", () => {
    // given
    const git = status()

    // when
    const rows = texts(buildFileRows(git, 40, 8))

    // then
    expect(rows).toEqual([
      "FILES  5 changed",
      " D gone.txt  +0/-1",
      "R  renamed-new.txt  +0/-0",
      " M tracked.txt  +2/-1",
      "M  with space.txt  +1/-0",
      "?? brand-new.txt",
    ])
  })

  test("#given more files than the cap #when built #then the rest is counted in the heading", () => {
    // given
    const git = status()

    // when
    const rows = texts(buildFileRows(git, 40, 2))

    // then
    expect(rows[0]).toBe("FILES  5 changed · +3 more")
    expect(rows).toHaveLength(3)
  })

  test("#given each state #when built #then untracked is dim, staged reads done, unstaged in flight", () => {
    // given
    const git = status()

    // when
    const rows = buildFileRows(git, 40, 8).slice(1)

    // then
    expect(rows.find((row) => row.text.startsWith("??"))?.color).toBe("dim")
    expect(rows.find((row) => row.text.startsWith("M "))?.color).toBe("success")
    expect(rows.find((row) => row.text.startsWith(" M"))?.color).toBe("text")
  })

  test("#given a merge conflict #when built #then the row is loud", () => {
    // given
    const git = { root: "/repo", files: [{ xy: "UU", path: "conflict.ts" }] }

    // when
    const rows = buildFileRows(git, 40, 8)

    // then
    expect(rows[1]?.color).toBe("error")
  })

  test("#given a clean working copy #when built #then the section stays empty", () => {
    // given
    const git = { root: "/repo", files: [] }

    // when
    const rows = buildFileRows(git, 40, 8)

    // then
    expect(rows).toEqual([])
  })

  test("#given a deep path #when built #then only the file name is shown", () => {
    // given
    const git = { root: "/repo", files: [{ xy: " M", path: "packages/omo-senpi/src/index.ts" }] }

    // when
    const rows = texts(buildFileRows(git, 40, 8))

    // then
    expect(rows[1]).toBe(" M index.ts")
  })
})

describe("buildFileRows on directories", () => {
  test("#given git reports an untracked directory #when built #then the row still has a name", () => {
    // given git writes a trailing slash for an untracked directory, and the naive basename of
    // that is the empty string
    const status = { root: "/repo", files: [{ xy: "??", path: "build/" }] }

    // when
    const rows = buildFileRows(status, 40, 8)

    // then
    expect(rows[1]?.text).toBe("?? build/")
  })

  test("#given a nested untracked directory #when built #then only its own name is shown", () => {
    // given
    const status = { root: "/repo", files: [{ xy: "??", path: "packages/omo-senpi/dist/" }] }

    // when
    const rows = buildFileRows(status, 40, 8)

    // then
    expect(rows[1]?.text).toBe("?? dist/")
  })
})
