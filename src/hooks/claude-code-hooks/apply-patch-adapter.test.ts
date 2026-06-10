import { describe, expect, it, mock, afterAll } from "bun:test"
import { restoreModuleMocksForTestFile } from "../../testing/module-mock-lifecycle"

const mockFindMatchingHooks = mock(() => [])

mock.module("../../shared", () => ({
	findMatchingHooks: mockFindMatchingHooks,
}))

afterAll(() => {
	mock.restore()
	restoreModuleMocksForTestFile(import.meta.url)
})

const {
	isApplyPatchTool,
	extractVirtualEdits,
	hasDirectApplyPatchMatcher,
	buildVirtualToolInput,
	deduplicateByFilePath,
} = await import("./apply-patch-adapter")

describe("apply-patch-adapter", () => {
	describe("isApplyPatchTool", () => {
		it("#given exact tool name #when checked #then returns true", () => {
			expect(isApplyPatchTool("apply_patch")).toBe(true)
		})

		it("#given tool name with whitespace #when checked #then returns true", () => {
			expect(isApplyPatchTool("  apply_patch ")).toBe(true)
		})

		it("#given uppercase tool name #when checked #then returns false", () => {
			expect(isApplyPatchTool("Apply_Patch")).toBe(false)
		})

		it("#given different tool name #when checked #then returns false", () => {
			expect(isApplyPatchTool("edit")).toBe(false)
			expect(isApplyPatchTool("write")).toBe(false)
			expect(isApplyPatchTool("bash")).toBe(false)
		})
	})

	describe("extractVirtualEdits", () => {
		it("#given metadata with files #when extracted #then maps to virtual edits", () => {
			// given
			const metadata = {
				files: [
					{
						filePath: "src/a.ts",
						before: "old content",
						after: "new content",
					},
				],
			}

			// when
			const edits = extractVirtualEdits(metadata)

			// then
			expect(edits).toHaveLength(1)
			expect(edits[0]).toEqual({
				filePath: "src/a.ts",
				ccToolName: "Edit",
				isNewFile: false,
				before: "old content",
				after: "new content",
			})
		})

		it("#given metadata with new file (empty before) #when extracted #then maps to Write", () => {
			// given
			const metadata = {
				files: [
					{
						filePath: "src/new.ts",
						before: "",
						after: "brand new content\n",
					},
				],
			}

			// when
			const edits = extractVirtualEdits(metadata)

			// then
			expect(edits).toHaveLength(1)
			expect(edits[0]).toEqual({
				filePath: "src/new.ts",
				ccToolName: "Write",
				isNewFile: true,
				before: "",
				after: "brand new content\n",
			})
		})

		it("#given no metadata and args with patchText #when extracted #then parses patch", () => {
			// given
			const patch =
				"*** Begin Patch\n*** Add File: src/new.ts\n+hello\n*** End Patch"

			// when
			const edits = extractVirtualEdits(undefined, { patchText: patch })

			// then
			expect(edits).toHaveLength(1)
			expect(edits[0].filePath).toBe("src/new.ts")
			expect(edits[0].ccToolName).toBe("Write")
			expect(edits[0].isNewFile).toBe(true)
		})

		it("#given no metadata and no args #when extracted #then returns empty", () => {
			expect(extractVirtualEdits(undefined)).toHaveLength(0)
		})

		it("#given empty metadata and empty args #when extracted #then returns empty", () => {
			expect(extractVirtualEdits({}, {})).toHaveLength(0)
		})

		it("#given metadata with delete file #when extracted #then skips delete", () => {
			// given
			const metadata = {
				files: [
					{
						filePath: "src/deleted.ts",
						before: "old",
						after: "new",
						type: "delete",
					},
				],
			}

			// when
			const edits = extractVirtualEdits(metadata)

			// then
			expect(edits).toHaveLength(0)
		})

		it("#given multiple files #when extracted #then maps all", () => {
			// given
			const metadata = {
				files: [
					{ filePath: "a.ts", before: "old_a", after: "new_a" },
					{ filePath: "b.ts", before: "", after: "new_b\n" },
					{ filePath: "c.ts", before: "old_c", after: "new_c" },
				],
			}

			// when
			const edits = extractVirtualEdits(metadata)

			// then
			expect(edits).toHaveLength(3)
			expect(edits[0].ccToolName).toBe("Edit")
			expect(edits[1].ccToolName).toBe("Write")
			expect(edits[2].ccToolName).toBe("Edit")
		})
	})

	describe("hasDirectApplyPatchMatcher", () => {
		it("#given null config #when checked #then returns false", () => {
			expect(hasDirectApplyPatchMatcher(null, "PreToolUse")).toBe(false)
		})

		it("#given config with no matching matcher #when checked #then returns false", () => {
			mockFindMatchingHooks.mockReturnValue([])
			expect(hasDirectApplyPatchMatcher({}, "PreToolUse")).toBe(false)
		})

		it("#given config with ApplyPatch matcher #when checked #then returns true", () => {
			mockFindMatchingHooks.mockReturnValue([{ matcher: "ApplyPatch", hooks: [] }])
			expect(hasDirectApplyPatchMatcher({}, "PreToolUse")).toBe(true)
		})

		it("#given config with ApplyPatch matcher for different event #when checked for other event #then returns false", () => {
			// PreToolUse has no match, PostToolUse has match
			let callCount = 0
			mockFindMatchingHooks.mockImplementation(() => {
				callCount++
				return callCount % 2 === 0 ? [{ matcher: "ApplyPatch", hooks: [] }] : []
			})
			expect(hasDirectApplyPatchMatcher({}, "PreToolUse")).toBe(false)
		})
	})

	describe("buildVirtualToolInput", () => {
		it("#given Edit edit #when built #then returns old_string/new_string", () => {
			// given
			const edit = {
				filePath: "src/a.ts",
				ccToolName: "Edit" as const,
				isNewFile: false,
				before: "old content",
				after: "new content",
			}

			// when
			const input = buildVirtualToolInput(edit)

			// then
			expect(input).toEqual({
				file_path: "src/a.ts",
				old_string: "old content",
				new_string: "new content",
			})
		})

		it("#given Write edit #when built #then returns content", () => {
			// given
			const edit = {
				filePath: "src/new.ts",
				ccToolName: "Write" as const,
				isNewFile: true,
				before: "",
				after: "brand new content\n",
			}

			// when
			const input = buildVirtualToolInput(edit)

			// then
			expect(input).toEqual({
				file_path: "src/new.ts",
				content: "brand new content\n",
			})
		})
	})

	describe("deduplicateByFilePath", () => {
		it("#given unique file paths #when deduplicated #then returns all", () => {
			// given
			const edits = [
				{ filePath: "a.ts", ccToolName: "Edit" as const, isNewFile: false, before: "a", after: "b" },
				{ filePath: "b.ts", ccToolName: "Edit" as const, isNewFile: false, before: "c", after: "d" },
			]

			// when
			const result = deduplicateByFilePath(edits)

			// then
			expect(result).toHaveLength(2)
		})

		it("#given duplicate file paths with same tool #when deduplicated #then keeps first", () => {
			// given
			const edits = [
				{ filePath: "a.ts", ccToolName: "Edit" as const, isNewFile: false, before: "1", after: "2" },
				{ filePath: "a.ts", ccToolName: "Edit" as const, isNewFile: false, before: "3", after: "4" },
			]

			// when
			const result = deduplicateByFilePath(edits)

			// then
			expect(result).toHaveLength(1)
			expect(result[0].before).toBe("1")
		})

		it("#given same file path with different tool #when deduplicated #then keeps both", () => {
			// given
			const edits = [
				{ filePath: "a.ts", ccToolName: "Edit" as const, isNewFile: false, before: "x", after: "y" },
				{ filePath: "a.ts", ccToolName: "Write" as const, isNewFile: true, before: "", after: "z\n" },
			]

			// when
			const result = deduplicateByFilePath(edits)

			// then
			expect(result).toHaveLength(2)
		})

		it("#given empty array #when deduplicated #then returns empty", () => {
			expect(deduplicateByFilePath([])).toHaveLength(0)
		})
	})
})
