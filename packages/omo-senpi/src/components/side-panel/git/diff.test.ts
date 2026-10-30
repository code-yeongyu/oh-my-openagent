import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { colorizeDiff, gitDiffArgs, readGitDiff, UNTRACKED_DIRECTORY_FILE_CAP } from "./diff"
import type { PanelExec } from "./read"

describe("gitDiffArgs", () => {
  test("#given a tracked change #when built #then the diff is taken against HEAD", () => {
    // given
    const file = { xy: " M", path: "tracked.txt" }

    // when
    const args = gitDiffArgs(file)

    // then
    expect(args).toEqual(["diff", "HEAD", "-M", "--", ":(literal)tracked.txt"])
  })

  test("#given a rename #when built #then both paths are in the pathspec", () => {
    // given
    const file = { xy: "R ", path: "renamed-new.txt", from: "renamed.txt" }

    // when
    const args = gitDiffArgs(file)

    // then
    expect(args).toEqual(["diff", "HEAD", "-M", "--", ":(literal)renamed.txt", ":(literal)renamed-new.txt"])
  })

  test("#given an untracked file #when built #then it is diffed against /dev/null", () => {
    // given
    const file = { xy: "??", path: "brand-new.txt" }

    // when
    const args = gitDiffArgs(file)

    // then
    expect(args).toEqual(["diff", "--no-index", "--", "/dev/null", "brand-new.txt"])
  })

  test("#given a wildcard in a path #when built #then git treats it literally", () => {
    // given
    const file = { xy: " M", path: "match*.txt" }

    // when
    const args = gitDiffArgs(file)

    // then
    expect(args.at(-1)).toBe(":(literal)match*.txt")
    expect(args).not.toContain("--literal-pathspecs")
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
    expect(calls[1]).toEqual(["diff", "--no-index", "--", "/dev/null", "new.txt"])
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

describe("readGitDiff pathspec environment", () => {
  const roots: string[] = []

  afterEach(() => {
    while (roots.length > 0) {
      const root = roots.pop()
      if (root !== undefined) rmSync(root, { recursive: true, force: true })
    }
  })

  /**
   * A PanelExec that really spawns the command through the inherited environment
   * only, the same shape the pinned host's `exec` has, which takes no `env`.
   * A test through this runner fails on the old global `--literal-pathspecs`
   * argv whenever a competing pathspec switch is exported (git exits 128).
   */
  const realExec: PanelExec = async (command, args, options) => {
    const result = spawnSync(command, [...args], {
      cwd: options?.cwd,
      env: process.env,
      encoding: "utf8",
      timeout: options?.timeout,
      windowsHide: true,
    })
    return { stdout: result.stdout ?? "", code: result.status ?? 1 }
  }

  function gitFixture(): string {
    const root = mkdtempSync(join(tmpdir(), "omo-panel-diff-"))
    roots.push(root)
    const git = (args: string[]): void => {
      spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true })
    }
    git(["init", "-q"])
    git(["config", "user.email", "panel@test"])
    git(["config", "user.name", "panel"])
    writeFileSync(join(root, "tracked.txt"), "a\n")
    git(["add", "tracked.txt"])
    git(["commit", "-qm", "init"])
    writeFileSync(join(root, "tracked.txt"), "a\nb\n")
    return root
  }

  test("#given a tracked diff and its fallback #when read #then no spawn carries the global literal flag or an env override", async () => {
    // given
    const seen: string[][] = []
    const runner: PanelExec = async (_command, args) => {
      seen.push([...args])
      return seen.length === 1 ? { stdout: "", code: 128 } : { stdout: "+hello", code: 1 }
    }

    // when
    await readGitDiff(runner, "/repo", { xy: "A ", path: "new.txt" })

    // then
    expect(seen).toHaveLength(2)
    expect(seen[0]?.at(-1)).toBe(":(literal)new.txt")
    expect(seen[1]).toEqual(["diff", "--no-index", "--", "/dev/null", "new.txt"])
    for (const args of seen) expect(args).not.toContain("--literal-pathspecs")
  })

  test("#given an untracked directory #when read #then the listing uses per-pathspec literal magic and per-file diffs stay plain", async () => {
    // given
    const seen: string[][] = []
    const runner: PanelExec = async (_command, args) => {
      seen.push([...args])
      if (args.includes("ls-files")) return { stdout: "build/a.txt\0build/b.txt\0", code: 0 }
      return { stdout: "+content", code: 1 }
    }

    // when
    await readGitDiff(runner, "/repo", { xy: "??", path: "build/" })

    // then
    expect(seen).toHaveLength(3)
    expect(seen[0]?.at(-1)).toBe(":(literal)build/")
    expect(seen[1]).toEqual(["diff", "--no-index", "--", "/dev/null", "build/a.txt"])
    for (const args of seen) expect(args).not.toContain("--literal-pathspecs")
  })

  for (const variable of ["GIT_GLOB_PATHSPECS", "GIT_ICASE_PATHSPECS"] as const) {
    test(`#given inherited ${variable}=1 #when a tracked diff is read through real git #then the diff is returned and the host env is untouched`, async () => {
      // given
      const root = gitFixture()
      const saved = process.env[variable]
      try {
        process.env[variable] = "1"

        // when
        const rows = await readGitDiff(realExec, root, { xy: " M", path: "tracked.txt" })

        // then
        expect(rows.map((row) => row.text)).toContain("+b")
        expect(process.env[variable]).toBe("1")
      } finally {
        if (saved === undefined) delete process.env[variable]
        else process.env[variable] = saved
      }
    })
  }

  test("#given both competing switches exported #when a tracked diff is read through real git #then the diff is returned", async () => {
    // given
    const root = gitFixture()
    const savedGlob = process.env.GIT_GLOB_PATHSPECS
    const savedIcase = process.env.GIT_ICASE_PATHSPECS
    try {
      process.env.GIT_GLOB_PATHSPECS = "1"
      process.env.GIT_ICASE_PATHSPECS = "1"

      // when
      const rows = await readGitDiff(realExec, root, { xy: " M", path: "tracked.txt" })

      // then
      expect(rows.map((row) => row.text)).toContain("+b")
    } finally {
      if (savedGlob === undefined) delete process.env.GIT_GLOB_PATHSPECS
      else process.env.GIT_GLOB_PATHSPECS = savedGlob
      if (savedIcase === undefined) delete process.env.GIT_ICASE_PATHSPECS
      else process.env.GIT_ICASE_PATHSPECS = savedIcase
    }
  })

  test("#given a glob character in a tracked name and GIT_GLOB_PATHSPECS=1 #when read through real git #then only the literal file is diffed", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-panel-diff-"))
    roots.push(root)
    const git = (args: string[]): void => {
      spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true })
    }
    git(["init", "-q"])
    git(["config", "user.email", "panel@test"])
    git(["config", "user.name", "panel"])
    // `[A]` is a glob character class every OS accepts in a file name (Windows refuses `*` and `?`)
    writeFileSync(join(root, "star[A]file.txt"), "a\n")
    writeFileSync(join(root, "starAfile.txt"), "a\n")
    git(["add", ":(literal)star[A]file.txt", "starAfile.txt"])
    git(["commit", "-qm", "init"])
    writeFileSync(join(root, "star[A]file.txt"), "a\nstar-only\n")
    writeFileSync(join(root, "starAfile.txt"), "a\nstarA-only\n")
    const saved = process.env.GIT_GLOB_PATHSPECS
    try {
      process.env.GIT_GLOB_PATHSPECS = "1"

      // when
      const rows = await readGitDiff(realExec, root, { xy: " M", path: "star[A]file.txt" })

      // then
      expect(rows.map((row) => row.text)).toContain("+star-only")
      expect(rows.map((row) => row.text)).not.toContain("+starA-only")
    } finally {
      if (saved === undefined) delete process.env.GIT_GLOB_PATHSPECS
      else process.env.GIT_GLOB_PATHSPECS = saved
    }
  })

  test("#given GIT_LITERAL_PATHSPECS=1 #when built #then the pathspec stays bare because literal matching is already on", () => {
    // given
    const saved = process.env.GIT_LITERAL_PATHSPECS
    try {
      process.env.GIT_LITERAL_PATHSPECS = "1"
      const file = { xy: " M", path: "tracked.txt" }

      // when
      const args = gitDiffArgs(file)

      // then
      expect(args).toEqual(["diff", "HEAD", "-M", "--", "tracked.txt"])
    } finally {
      if (saved === undefined) delete process.env.GIT_LITERAL_PATHSPECS
      else process.env.GIT_LITERAL_PATHSPECS = saved
    }
  })

  test("#given GIT_LITERAL_PATHSPECS=1 and a tracked diff #when read through real git #then the diff is returned instead of an empty match", async () => {
    // given
    const root = gitFixture()
    const saved = process.env.GIT_LITERAL_PATHSPECS
    try {
      process.env.GIT_LITERAL_PATHSPECS = "1"

      // when
      const rows = await readGitDiff(realExec, root, { xy: " M", path: "tracked.txt" })

      // then
      expect(rows.map((row) => row.text)).toContain("+b")
    } finally {
      if (saved === undefined) delete process.env.GIT_LITERAL_PATHSPECS
      else process.env.GIT_LITERAL_PATHSPECS = saved
    }
  })

  test("#given GIT_LITERAL_PATHSPECS=1 and an untracked directory #when read through real git #then the listing and per-file diffs are returned", async () => {
    // given
    const root = gitFixture()
    mkdirSync(join(root, "build"))
    writeFileSync(join(root, "build", "new.txt"), "hello\n")
    const saved = process.env.GIT_LITERAL_PATHSPECS
    try {
      process.env.GIT_LITERAL_PATHSPECS = "1"

      // when
      const rows = await readGitDiff(realExec, root, { xy: "??", path: "build/" })

      // then
      expect(rows.map((row) => row.text)).toContain("+hello")
    } finally {
      if (saved === undefined) delete process.env.GIT_LITERAL_PATHSPECS
      else process.env.GIT_LITERAL_PATHSPECS = saved
    }
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
