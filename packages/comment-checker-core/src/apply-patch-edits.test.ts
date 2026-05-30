import { describe, test, expect } from "bun:test"

import {
  extractApplyPatchEdits,
  getApplyPatchMetadataFiles,
  getString,
  isRecord,
  joinPatchLines,
  makeAccumulator,
  parseApplyPatchRequests,
  readApplyPatchMetadataFiles,
} from "./apply-patch-edits"

describe("apply-patch-edits", () => {
  describe("isRecord", () => {
    describe("#given null", () => {
      test("#then returns false", () => {
        expect(isRecord(null)).toBe(false)
      })
    })

    describe("#given undefined", () => {
      test("#then returns false", () => {
        expect(isRecord(undefined)).toBe(false)
      })
    })

    describe("#given a plain object", () => {
      test("#then returns true", () => {
        expect(isRecord({ foo: "bar" })).toBe(true)
      })
    })

    describe("#given an array", () => {
      test("#then returns true", () => {
        // arrays are objects in JS
        expect(isRecord([])).toBe(true)
      })
    })

    describe("#given a string", () => {
      test("#then returns false", () => {
        expect(isRecord("hello")).toBe(false)
      })
    })

    describe("#given a number", () => {
      test("#then returns false", () => {
        expect(isRecord(42)).toBe(false)
      })
    })
  })

  describe("getString", () => {
    describe("#given an object with a matching key", () => {
      test("#then returns the string value for the first matching key", () => {
        const input = { filePath: "src/index.ts", path: "other.ts" }
        expect(getString(input, ["filePath", "path"])).toBe("src/index.ts")
      })
    })

    describe("#given an object where first key is non-string", () => {
      test("#then skips non-string and returns next matching key", () => {
        const input = { filePath: 123, path: "fallback.ts" }
        expect(getString(input, ["filePath", "path"])).toBe("fallback.ts")
      })
    })

    describe("#given an object with no matching keys", () => {
      test("#then returns undefined", () => {
        const input = { unrelated: "value" }
        expect(getString(input, ["filePath", "path"])).toBeUndefined()
      })
    })

    describe("#given an empty keys array", () => {
      test("#then returns undefined", () => {
        const input = { filePath: "test.ts" }
        expect(getString(input, [])).toBeUndefined()
      })
    })
  })

  describe("joinPatchLines", () => {
    describe("#given an empty array", () => {
      test("#then returns empty string", () => {
        expect(joinPatchLines([])).toBe("")
      })
    })

    describe("#given a single line", () => {
      test("#then returns line with trailing newline", () => {
        expect(joinPatchLines(["hello"])).toBe("hello\n")
      })
    })

    describe("#given multiple lines", () => {
      test("#then joins with newline and appends trailing newline", () => {
        expect(joinPatchLines(["line1", "line2", "line3"])).toBe("line1\nline2\nline3\n")
      })
    })
  })

  describe("makeAccumulator", () => {
    describe("#given operation and filePath", () => {
      test("#then creates accumulator with empty line arrays", () => {
        const acc = makeAccumulator("add", "src/new-file.ts")
        expect(acc.operation).toBe("add")
        expect(acc.filePath).toBe("src/new-file.ts")
        expect(acc.oldLines).toEqual([])
        expect(acc.newLines).toEqual([])
        expect(acc.movePath).toBeUndefined()
      })
    })

    describe("#given delete operation", () => {
      test("#then creates accumulator with delete operation", () => {
        const acc = makeAccumulator("delete", "old-file.ts")
        expect(acc.operation).toBe("delete")
        expect(acc.filePath).toBe("old-file.ts")
      })
    })
  })

  describe("readApplyPatchMetadataFiles", () => {
    describe("#given a non-array value", () => {
      test("#then returns empty array for string", () => {
        expect(readApplyPatchMetadataFiles("not an array")).toEqual([])
      })

      test("#then returns empty array for null", () => {
        expect(readApplyPatchMetadataFiles(null)).toEqual([])
      })

      test("#then returns empty array for object", () => {
        expect(readApplyPatchMetadataFiles({ key: "value" })).toEqual([])
      })
    })

    describe("#given an array with missing required fields", () => {
      test("#then skips items without filePath", () => {
        const value = [{ before: "old", after: "new" }]
        expect(readApplyPatchMetadataFiles(value)).toEqual([])
      })

      test("#then skips items without before", () => {
        const value = [{ filePath: "test.ts", after: "new" }]
        expect(readApplyPatchMetadataFiles(value)).toEqual([])
      })

      test("#then skips items without after", () => {
        const value = [{ filePath: "test.ts", before: "old" }]
        expect(readApplyPatchMetadataFiles(value)).toEqual([])
      })
    })

    describe("#given an array with non-record items", () => {
      test("#then skips non-record items", () => {
        const value = ["string", 42, null, { filePath: "a.ts", before: "x", after: "y" }]
        const result = readApplyPatchMetadataFiles(value)
        expect(result).toHaveLength(1)
        expect(result[0].filePath).toBe("a.ts")
      })
    })

    describe("#given valid entries with alternate key names", () => {
      test("#then resolves file_path, old_string, new_string", () => {
        const value = [{ file_path: "b.ts", old_string: "before", new_string: "after" }]
        const result = readApplyPatchMetadataFiles(value)
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({ filePath: "b.ts", before: "before", after: "after" })
      })
    })

    describe("#given entries with optional movePath and type", () => {
      test("#then includes movePath and type when present", () => {
        const value = [
          { filePath: "old.ts", before: "x", after: "y", movePath: "new.ts", type: "update" },
        ]
        const result = readApplyPatchMetadataFiles(value)
        expect(result[0]).toEqual({
          filePath: "old.ts",
          before: "x",
          after: "y",
          movePath: "new.ts",
          type: "update",
        })
      })
    })
  })

  describe("getApplyPatchMetadataFiles", () => {
    describe("#given a non-record value", () => {
      test("#then returns empty array", () => {
        expect(getApplyPatchMetadataFiles(null)).toEqual([])
        expect(getApplyPatchMetadataFiles("string")).toEqual([])
        expect(getApplyPatchMetadataFiles(42)).toEqual([])
      })
    })

    describe("#given details with direct files array", () => {
      test("#then reads from details.files", () => {
        const details = {
          files: [{ filePath: "direct.ts", before: "a", after: "b" }],
        }
        const result = getApplyPatchMetadataFiles(details)
        expect(result).toHaveLength(1)
        expect(result[0].filePath).toBe("direct.ts")
      })
    })

    describe("#given details with result.files", () => {
      test("#then falls back to details.result.files", () => {
        const details = {
          files: [],
          result: { files: [{ filePath: "result.ts", before: "a", after: "b" }] },
        }
        const result = getApplyPatchMetadataFiles(details)
        expect(result).toHaveLength(1)
        expect(result[0].filePath).toBe("result.ts")
      })
    })

    describe("#given details with metadata.files", () => {
      test("#then falls back to details.metadata.files", () => {
        const details = {
          files: [],
          result: { files: [] },
          metadata: { files: [{ filePath: "meta.ts", before: "a", after: "b" }] },
        }
        const result = getApplyPatchMetadataFiles(details)
        expect(result).toHaveLength(1)
        expect(result[0].filePath).toBe("meta.ts")
      })
    })

    describe("#given details with non-record result", () => {
      test("#then skips result and tries metadata", () => {
        const details = {
          files: [],
          result: "not a record",
          metadata: { files: [{ filePath: "meta.ts", before: "a", after: "b" }] },
        }
        const result = getApplyPatchMetadataFiles(details)
        expect(result).toHaveLength(1)
        expect(result[0].filePath).toBe("meta.ts")
      })
    })
  })

  describe("parseApplyPatchRequests", () => {
    describe("#given an empty patch", () => {
      test("#then returns empty array", () => {
        expect(parseApplyPatchRequests("")).toEqual([])
      })
    })

    describe("#given a patch with Add File", () => {
      test("#then creates edit with empty before and content as after", () => {
        const patch = [
          "*** Begin Patch",
          "*** Add File: src/new.ts",
          "+export const x = 1",
          "+export const y = 2",
          "*** End Patch",
        ].join("\n")

        const result = parseApplyPatchRequests(patch)
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          filePath: "src/new.ts",
          before: "",
          after: "export const x = 1\nexport const y = 2\n",
        })
      })
    })

    describe("#given a patch with Update File", () => {
      test("#then creates edit with old and new content", () => {
        const patch = [
          "*** Begin Patch",
          "*** Update File: src/existing.ts",
          "@@ -1,2 +1,2 @@",
          "-const old = true",
          "+const updated = true",
          "*** End Patch",
        ].join("\n")

        const result = parseApplyPatchRequests(patch)
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          filePath: "src/existing.ts",
          before: "const old = true\n",
          after: "const updated = true\n",
        })
      })
    })

    describe("#given a patch with Delete File", () => {
      test("#then produces no edit (delete is skipped)", () => {
        const patch = [
          "*** Begin Patch",
          "*** Delete File: src/removed.ts",
          "*** End Patch",
        ].join("\n")

        const result = parseApplyPatchRequests(patch)
        expect(result).toEqual([])
      })
    })

    describe("#given a patch with Move to", () => {
      test("#then uses movePath as filePath in the edit", () => {
        const patch = [
          "*** Begin Patch",
          "*** Update File: src/old-name.ts",
          "*** Move to: src/new-name.ts",
          "@@ -1,1 +1,1 @@",
          "-old content",
          "+new content",
          "*** End Patch",
        ].join("\n")

        const result = parseApplyPatchRequests(patch)
        expect(result).toHaveLength(1)
        expect(result[0].filePath).toBe("src/new-name.ts")
      })
    })

    describe("#given a patch with CRLF line endings", () => {
      test("#then handles CRLF correctly", () => {
        const patch = [
          "*** Begin Patch",
          "*** Add File: src/crlf.ts",
          "+line one",
          "+line two",
          "*** End Patch",
        ].join("\r\n")

        const result = parseApplyPatchRequests(patch)
        expect(result).toHaveLength(1)
        expect(result[0].after).toBe("line one\nline two\n")
      })
    })

    describe("#given multiple file operations in one patch", () => {
      test("#then produces multiple edits", () => {
        const patch = [
          "*** Begin Patch",
          "*** Add File: src/a.ts",
          "+const a = 1",
          "*** Add File: src/b.ts",
          "+const b = 2",
          "*** End Patch",
        ].join("\n")

        const result = parseApplyPatchRequests(patch)
        expect(result).toHaveLength(2)
        expect(result[0].filePath).toBe("src/a.ts")
        expect(result[1].filePath).toBe("src/b.ts")
      })
    })

    describe("#given an add file with no + lines", () => {
      test("#then produces no edit (empty after)", () => {
        const patch = [
          "*** Begin Patch",
          "*** Add File: src/empty.ts",
          "*** End Patch",
        ].join("\n")

        const result = parseApplyPatchRequests(patch)
        expect(result).toEqual([])
      })
    })
  })

  describe("extractApplyPatchEdits", () => {
    describe("#given details with metadata files", () => {
      test("#then returns edits from metadata, filtering deletes", () => {
        const details = {
          files: [
            { filePath: "keep.ts", before: "old", after: "new", type: "update" },
            { filePath: "removed.ts", before: "x", after: "y", type: "Delete" },
          ],
        }

        const result = extractApplyPatchEdits(details)
        expect(result).toHaveLength(1)
        expect(result[0].filePath).toBe("keep.ts")
      })
    })

    describe("#given details with movePath in metadata", () => {
      test("#then uses movePath as filePath", () => {
        const details = {
          files: [
            { filePath: "old.ts", movePath: "new.ts", before: "a", after: "b", type: "update" },
          ],
        }

        const result = extractApplyPatchEdits(details)
        expect(result[0].filePath).toBe("new.ts")
      })
    })

    describe("#given no metadata files and args with patchText", () => {
      test("#then falls back to parsing args patch text", () => {
        const details = {}
        const args = {
          patchText: [
            "*** Begin Patch",
            "*** Add File: src/fallback.ts",
            "+fallback content",
            "*** End Patch",
          ].join("\n"),
        }

        const result = extractApplyPatchEdits(details, args)
        expect(result).toHaveLength(1)
        expect(result[0].filePath).toBe("src/fallback.ts")
        expect(result[0].after).toBe("fallback content\n")
      })
    })

    describe("#given no metadata files and no args", () => {
      test("#then returns empty array", () => {
        const result = extractApplyPatchEdits({})
        expect(result).toEqual([])
      })
    })

    describe("#given no metadata files and args without patch keys", () => {
      test("#then returns empty array", () => {
        const result = extractApplyPatchEdits({}, { unrelated: "value" })
        expect(result).toEqual([])
      })
    })

    describe("#given args with input key", () => {
      test("#then uses input as patch text", () => {
        const args = {
          input: [
            "*** Begin Patch",
            "*** Add File: src/from-input.ts",
            "+from input",
            "*** End Patch",
          ].join("\n"),
        }

        const result = extractApplyPatchEdits(null, args)
        expect(result).toHaveLength(1)
        expect(result[0].filePath).toBe("src/from-input.ts")
      })
    })
  })
})
