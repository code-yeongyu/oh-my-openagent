import { describe, expect, test } from "bun:test"

import { colorizeDiff, gitDiffArgs, readGitDiff } from "./diff"
import type { PanelExec } from "./read"

describe("gitDiffArgs", () => {
  test("#given a tracked change #when built #then the diff is taken against HEAD", () => {
    // given
    const file = { xy: " M", path: "tracked.txt" }

    // when
    const args = gitDiffArgs(file)

    // then
    expect(args).toEqual(["diff", "HEAD", "-M", "--", "tracked.txt"])
  })

  test("#given a rename #when built #then both paths are in the pathspec", () => {
    // given
    const file = { xy: "R ", path: "renamed-new.txt", from: "renamed.txt" }

    // when
    const args = gitDiffArgs(file)

    // then
    expect(args).toEqual(["diff", "HEAD", "-M", "--", "renamed.txt", "renamed-new.txt"])
  })

  test("#given an untracked file #when built #then it is diffed against /dev/null", () => {
    // given
    const file = { xy: "??", path: "brand-new.txt" }

    // when
    const args = gitDiffArgs(file)

    // then
    expect(args).toEqual(["diff", "--no-index", "--", "/dev/null", "brand-new.txt"])
  })
})

describe("colorizeDiff", () => {
  test("#given a diff #when coloured #then each line kind gets its own colour", () => {
    // given
    const output = [
      "diff --git a/tracked.txt b/tracked.txt",
      "index de98044..dcaf2c1 100644",
      "--- a/tracked.txt",
      "+++ b/tracked.txt",
      "@@ -1,3 +1,4 @@",
      " a",
      "-b",
      "+B-EDIT",
      " c",
    ].join("\n")

    // when
    const rows = colorizeDiff(output)

    // then
    expect(rows.map((row) => row.color)).toEqual([
      "muted",
      "muted",
      "muted",
      "muted",
      "accent",
      "text",
      "error",
      "success",
      "text",
    ])
  })

  test("#given rename headers #when coloured #then they read as structure, not as content", () => {
    // given
    const output = ["similarity index 100%", "rename from renamed.txt", "rename to renamed-new.txt"].join("\n")

    // when
    const rows = colorizeDiff(output)

    // then
    expect(rows.every((row) => row.color === "muted")).toBe(true)
  })

  test("#given a new file header #when coloured #then it is not mistaken for an added line", () => {
    // given
    const output = "new file mode 100644"

    // when
    const rows = colorizeDiff(output)

    // then
    expect(rows[0]?.color).toBe("muted")
  })
})

describe("readGitDiff", () => {
  const exec = (stdout: string, code: number): PanelExec => async () => ({ stdout, code })

  test("#given an untracked file whose diff exits 1 #when read #then the content is still returned", async () => {
    // given
    const runner = exec("+++ b/new.txt\n+hello", 1)

    // when
    const rows = await readGitDiff(runner, "/repo", { xy: "??", path: "new.txt" })

    // then
    expect(rows.map((row) => row.text)).toEqual(["+++ b/new.txt", "+hello"])
  })

  test("#given a real failure #when read #then the exit code is reported", async () => {
    // given
    const runner = exec("", 128)

    // when
    const rows = await readGitDiff(runner, "/repo", { xy: " M", path: "gone.txt" })

    // then
    expect(rows[0]?.text).toContain("exit 128")
    expect(rows[0]?.color).toBe("error")
  })

  test("#given an unchanged file #when read #then the viewer says so instead of showing nothing", async () => {
    // given
    const runner = exec("", 0)

    // when
    const rows = await readGitDiff(runner, "/repo", { xy: " M", path: "same.txt" })

    // then
    expect(rows).toEqual([{ text: "no textual change", color: "muted" }])
  })

  test("#given exec throws #when read #then the viewer reports it rather than propagating", async () => {
    // given
    const runner: PanelExec = async () => {
      throw new Error("spawn ENOENT")
    }

    // when
    const rows = await readGitDiff(runner, "/repo", { xy: " M", path: "x.txt" })

    // then
    expect(rows[0]?.color).toBe("error")
  })
})
