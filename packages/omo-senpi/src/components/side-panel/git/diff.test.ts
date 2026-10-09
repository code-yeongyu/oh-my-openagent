import { describe, expect, test } from "bun:test"

import { colorizeDiff, gitDiffArgs, readGitDiff, UNTRACKED_DIRECTORY_FILE_CAP } from "./diff"
import type { PanelExec } from "./read"

describe("gitDiffArgs", () => {
  test("#given a tracked change #when built #then the diff is taken against HEAD", () => {
    // given
    const file = { xy: " M", path: "tracked.txt" }

    // when
    const args = gitDiffArgs(file)

    // then
    expect(args).toEqual(["--literal-pathspecs", "diff", "HEAD", "-M", "--", "tracked.txt"])
  })

  test("#given a rename #when built #then both paths are in the pathspec", () => {
    // given
    const file = { xy: "R ", path: "renamed-new.txt", from: "renamed.txt" }

    // when
    const args = gitDiffArgs(file)

    // then
    expect(args).toEqual(["--literal-pathspecs", "diff", "HEAD", "-M", "--", "renamed.txt", "renamed-new.txt"])
  })

  test("#given an untracked file #when built #then it is diffed against /dev/null", () => {
    // given
    const file = { xy: "??", path: "brand-new.txt" }

    // when
    const args = gitDiffArgs(file)

    // then
    expect(args).toEqual(["--literal-pathspecs", "diff", "--no-index", "--", "/dev/null", "brand-new.txt"])
  })

  test("#given a wildcard in a path #when built #then git treats it literally", () => {
    // given
    const file = { xy: " M", path: "match*.txt" }

    // when
    const args = gitDiffArgs(file)

    // then
    expect(args[0]).toBe("--literal-pathspecs")
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

  test("#given a staged addition before the first commit #when HEAD is absent #then the file is diffed against null", async () => {
    // given
    const calls: string[][] = []
    const runner: PanelExec = async (_command, args) => {
      calls.push([...args])
      return calls.length === 1
        ? { stdout: "", code: 128 }
        : { stdout: "+++ b/new.txt\n+hello", code: 1 }
    }

    // when
    const rows = await readGitDiff(runner, "/repo", { xy: "A ", path: "new.txt" })

    // then
    expect(calls[1]).toEqual(["--literal-pathspecs", "diff", "--no-index", "--", "/dev/null", "new.txt"])
    expect(rows.map((row) => row.text)).toEqual(["+++ b/new.txt", "+hello"])
  })

  test("#given an untracked directory #when read #then every file inside is diffed", async () => {
    // given
    const calls: string[][] = []
    const runner: PanelExec = async (_command, args) => {
      calls.push([...args])
      if (args.includes("ls-files")) return { stdout: "build/a.txt\u0000build/nested/b.txt\u0000", code: 0 }
      const path = args.at(-1)
      return { stdout: `+++ b/${path}\n+content`, code: 1 }
    }

    // when
    const rows = await readGitDiff(runner, "/repo", { xy: "??", path: "build/" })

    // then
    expect(calls).toHaveLength(3)
    expect(rows.map((row) => row.text)).toEqual([
      "+++ b/build/a.txt",
      "+content",
      "+++ b/build/nested/b.txt",
      "+content",
    ])
  })
})

describe("readGitDiff untracked directory cap", () => {
  test("#given an untracked directory with more files than the cap #when opened #then only the cap is diffed and the rest is counted", async () => {
    // given
    const listed = Array.from({ length: UNTRACKED_DIRECTORY_FILE_CAP + 7 }, (_, index) => `build/f${index}.txt`)
    let diffs = 0
    const exec: PanelExec = async (_command, args) => {
      if (args.includes("ls-files")) return { stdout: `${listed.join("\0")}\0`, stderr: "", code: 0, killed: false }
      diffs += 1
      return { stdout: "+x\n", stderr: "", code: 1, killed: false }
    }

    // when
    const rows = await readGitDiff(exec, "/repo", { xy: "??", path: "build/" })

    // then
    expect(diffs).toBe(UNTRACKED_DIRECTORY_FILE_CAP)
    expect(rows.at(-1)?.text).toBe("... 7 more files in build/")
  })
})
