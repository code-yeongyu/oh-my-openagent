import { describe, expect, test } from "bun:test"
import { normalizeArgs, validateArgs } from "./look-at-arguments"

describe("look-at arguments", () => {
  describe("normalizeArgs", () => {
    describe("#given singular inputs", () => {
      describe("#when file_path is provided", () => {
        test("#then normalizes single file_path into file_paths", () => {
          const normalized = normalizeArgs({
            file_path: "/tmp/example.png",
            goal: "analyze image",
          })

          expect(normalized.file_path).toBe("/tmp/example.png")
          expect(normalized.file_paths).toEqual(["/tmp/example.png"])
          expect(normalized.image_data_list).toBeUndefined()
        })
      })

      describe("#when image_data is provided", () => {
        test("#then normalizes single image_data into image_data_list", () => {
          const normalized = normalizeArgs({
            image_data: "data:image/png;base64,abc123",
            goal: "analyze image",
          })

          expect(normalized.image_data).toBe("data:image/png;base64,abc123")
          expect(normalized.image_data_list).toEqual(["data:image/png;base64,abc123"])
          expect(normalized.file_paths).toBeUndefined()
        })
      })
    })

    describe("#given plural inputs", () => {
      describe("#when arrays are provided", () => {
        test("#then preserves provided file_paths and image_data_list arrays", () => {
          const normalized = normalizeArgs({
            file_paths: ["/tmp/a.png", "/tmp/b.png"],
            image_data_list: ["data:image/png;base64,abc123"],
            goal: "compare inputs",
          })

          expect(normalized.file_paths).toEqual(["/tmp/a.png", "/tmp/b.png"])
          expect(normalized.image_data_list).toEqual(["data:image/png;base64,abc123"])
        })
      })
    })
  })

  describe("validateArgs", () => {
    describe("#given valid backward-compatible inputs", () => {
      describe("#when a single file_path is provided", () => {
        test("#then validation succeeds", () => {
          const args = normalizeArgs({
            file_path: "/tmp/example.png",
            goal: "analyze image",
          })

          expect(validateArgs(args)).toBeNull()
          expect(args.file_paths).toEqual(["/tmp/example.png"])
        })
      })

      describe("#when a single image_data value is provided", () => {
        test("#then validation succeeds", () => {
          const args = normalizeArgs({
            image_data: "data:image/png;base64,abc123",
            goal: "analyze image",
          })

          expect(validateArgs(args)).toBeNull()
          expect(args.image_data_list).toEqual(["data:image/png;base64,abc123"])
        })
      })
    })

    describe("#given valid multi-file inputs", () => {
      describe("#when file_paths is provided", () => {
        test("#then validation succeeds", () => {
          const args = normalizeArgs({
            file_paths: ["/tmp/a.png", "/tmp/b.png"],
            goal: "compare images",
          })

          expect(validateArgs(args)).toBeNull()
        })
      })

      describe("#when file_paths and image_data_list are both provided", () => {
        test("#then validation succeeds for mixed sources", () => {
          const args = normalizeArgs({
            file_paths: ["/tmp/a.png", "/tmp/b.png"],
            image_data_list: ["data:image/png;base64,abc123"],
            goal: "compare inputs",
          })

          expect(validateArgs(args)).toBeNull()
        })
      })
    })

    describe("#given conflicting singular and plural forms", () => {
      describe("#when file_path and file_paths are both provided", () => {
        test("#then validation rejects the conflict", () => {
          const args = normalizeArgs({
            file_path: "/tmp/a.png",
            file_paths: ["/tmp/b.png"],
            goal: "compare images",
          })

          expect(validateArgs(args)).toContain("file_path")
          expect(validateArgs(args)).toContain("file_paths")
        })
      })

      describe("#when image_data and image_data_list are both provided", () => {
        test("#then validation rejects the conflict", () => {
          const args = normalizeArgs({
            image_data: "data:image/png;base64,abc123",
            image_data_list: ["data:image/png;base64,def456"],
            goal: "compare images",
          })

          expect(validateArgs(args)).toContain("image_data")
          expect(validateArgs(args)).toContain("image_data_list")
        })
      })
    })

    describe("#given invalid collections", () => {
      describe("#when file_paths is empty", () => {
        test("#then validation rejects the empty array", () => {
          const args = normalizeArgs({
            file_paths: [],
            goal: "analyze images",
          })

          expect(validateArgs(args)).toContain("file_paths")
        })
      })

      describe("#when no file or image inputs are provided", () => {
        test("#then validation rejects the missing inputs", () => {
          const args = normalizeArgs({
            goal: "analyze images",
          })

          expect(validateArgs(args)).toContain("file_path")
          expect(validateArgs(args)).toContain("file_paths")
          expect(validateArgs(args)).toContain("image_data")
          expect(validateArgs(args)).toContain("image_data_list")
        })
      })
    })

    describe("#given invalid file paths", () => {
      describe("#when any file_paths entry is a remote URL", () => {
        test("#then validation rejects the remote path", () => {
          const args = normalizeArgs({
            file_paths: ["/tmp/a.png", "https://example.com/remote.png"],
            goal: "compare images",
          })

          expect(validateArgs(args)).toContain("Remote URLs are not supported")
        })
      })
    })
  })
})
