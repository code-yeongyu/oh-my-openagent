/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { classifyHunk, hunkTargetPath, parsePatchTarget, splitHunks } from "./verify-patch-hunks"

describe("parsePatchTarget", () => {
  test("#given a version-scoped scoped-package patch name #when parsed #then package name and version split on the last @", () => {
    // given
    const fileName = "@code-yeongyu%2Fsenpi@2026.8.31.patch"

    // when
    const target = parsePatchTarget(fileName)

    // then
    expect(target.file).toBe(fileName)
    expect(target.name).toBe("@code-yeongyu/senpi")
    expect(target.version).toBe("2026.8.31")
  })

  test("#given a name without a version suffix #when parsed #then it is rejected", () => {
    // given
    const fileName = "senpi.patch"

    // when / then
    expect(() => parsePatchTarget(fileName)).toThrow("must be")
  })

  test("#given a non patch file #when parsed #then it is rejected", () => {
    // given
    const fileName = "notes.txt"

    // when / then
    expect(() => parsePatchTarget(fileName)).toThrow("not a patch file")
  })
})

describe("splitHunks", () => {
  test("#given a two-hunk single-file diff #when split #then each hunk keeps the file header", () => {
    // given
    const diff = [
      "diff --git a/dist/x.js b/dist/x.js",
      "index 1111111..2222222 100644",
      "--- a/dist/x.js",
      "+++ b/dist/x.js",
      "@@ -1,3 +1,4 @@",
      " alpha",
      " beta",
      "+gamma",
      " delta",
      "@@ -10,3 +11,4 @@",
      " eps",
      "+zeta",
      " eta",
    ].join("\n")

    // when
    const hunks = splitHunks(diff)

    // then
    expect(hunks).toHaveLength(2)
    for (const hunk of hunks) {
      expect(hunk.header).toEqual([
        "diff --git a/dist/x.js b/dist/x.js",
        "index 1111111..2222222 100644",
        "--- a/dist/x.js",
        "+++ b/dist/x.js",
      ])
    }
    expect(hunks[0]?.body[0]).toBe("@@ -1,3 +1,4 @@")
    expect(hunks[0]?.body).toContain("+gamma")
    expect(hunks[1]?.body[0]).toBe("@@ -10,3 +11,4 @@")
    expect(hunks[1]?.body).toContain("+zeta")
  })

  test("#given a multi-file diff #when split #then each hunk carries its own section header", () => {
    // given
    const diff = [
      "diff --git a/dist/a.js b/dist/a.js",
      "index 1111111..2222222 100644",
      "--- a/dist/a.js",
      "+++ b/dist/a.js",
      "@@ -1,2 +1,3 @@",
      " alpha",
      "+extra",
      " beta",
      "diff --git a/dist/b.js b/dist/b.js",
      "index 3333333..4444444 100644",
      "--- a/dist/b.js",
      "+++ b/dist/b.js",
      "@@ -5,2 +5,3 @@",
      " gamma",
      "+more",
      " delta",
    ].join("\n")

    // when
    const hunks = splitHunks(diff)

    // then
    expect(hunks).toHaveLength(2)
    expect(hunkTargetPath(hunks[0]!)).toBe("dist/a.js")
    expect(hunkTargetPath(hunks[1]!)).toBe("dist/b.js")
  })
})

describe("classifyHunk", () => {
  test("#given a failed hunk whose additions already exist upstream #when classified #then it is obsolete", () => {
    // given
    const hunk = {
      header: [
        "diff --git a/dist/x.js b/dist/x.js",
        "--- a/dist/x.js",
        "+++ b/dist/x.js",
      ],
      body: ["@@ -1,3 +1,4 @@", " alpha", " beta", "+gamma", " delta"],
    }
    const targetContent = "alpha\nbeta\ngamma\ndelta\n"

    // when
    const verdict = classifyHunk(hunk, targetContent)

    // then
    expect(verdict).toBe("obsolete")
  })

  test("#given a removal-only hunk whose lines are gone upstream #when classified #then it is obsolete", () => {
    // given
    const hunk = {
      header: [
        "diff --git a/dist/x.js b/dist/x.js",
        "--- a/dist/x.js",
        "+++ b/dist/x.js",
      ],
      body: ["@@ -1,2 +1,1 @@", "-legacy", " beta"],
    }
    const targetContent = "beta\ngamma\n"

    // when
    const verdict = classifyHunk(hunk, targetContent)

    // then
    expect(verdict).toBe("obsolete")
  })

  test("#given a hunk whose target content moved on without its change #when classified #then it is a conflict", () => {
    // given
    const hunk = {
      header: [
        "diff --git a/dist/x.js b/dist/x.js",
        "--- a/dist/x.js",
        "+++ b/dist/x.js",
      ],
      body: ["@@ -1,3 +1,4 @@", " alpha", " beta", "+gamma", " delta"],
    }
    const targetContent = "alpha\nbeta\nrewritten tail\n"

    // when
    const verdict = classifyHunk(hunk, targetContent)

    // then
    expect(verdict).toBe("conflict")
  })

  test("#given a failed hunk with no resolvable target file #when classified #then it is a conflict", () => {
    // given
    const hunk = {
      header: ["diff --git a/dist/x.js b/dist/x.js"],
      body: ["@@ -1,1 +1,2 @@", "+gamma"],
    }

    // when
    const verdict = classifyHunk(hunk, null)

    // then
    expect(verdict).toBe("conflict")
  })
})
