import { describe, expect, test } from "bun:test"
import { getApplyPatchMetadataFiles, isRecord } from "./apply-patch-edits"

describe("apply-patch edit metadata", () => {
  test("#given array metadata details #when reading apply-patch metadata files #then legacy record semantics still accept the array wrapper", () => {
    // given
    const details: unknown[] & { files?: unknown } = []
    details.files = [
      {
        filePath: "src/example.ts",
        before: "before",
        after: "after",
      },
    ]

    // when
    const files = getApplyPatchMetadataFiles(details)

    // then
    expect(isRecord(details)).toBe(true)
    expect(files).toEqual([
      {
        filePath: "src/example.ts",
        before: "before",
        after: "after",
      },
    ])
  })
})
