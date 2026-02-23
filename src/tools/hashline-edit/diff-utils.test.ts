import { describe, it, expect } from "bun:test"
import { generateUnifiedDiff } from "./diff-utils"

describe("generateUnifiedDiff", () => {
	describe("#given basic line change", () => {
		describe("#when old and new content differ on a line", () => {
			it("#then produces correct hunks with minus and plus markers", () => {
				const oldContent = "line1\nline2\nline3"
				const newContent = "line1\nmodified\nline3"
				const filePath = "test.txt"

				const result = generateUnifiedDiff(oldContent, newContent, filePath)

				expect(result).toContain("--- test.txt")
				expect(result).toContain("+++ test.txt")
				expect(result).toContain("@@")
				expect(result).toContain("-line2")
				expect(result).toContain("+modified")
				expect(result).toContain(" line3")
			})
		})
	})

	describe("#given content with insertion", () => {
		describe("#when a new line is added", () => {
			it("#then produces hunks with plus marker for inserted line", () => {
				const oldContent = "line1\nline3"
				const newContent = "line1\nline2\nline3"
				const filePath = "test.txt"

				const result = generateUnifiedDiff(oldContent, newContent, filePath)

				expect(result).toContain("+line2")
			})
		})
	})

	describe("#given content with deletion", () => {
		describe("#when a line is removed", () => {
			it("#then produces hunks with minus marker for deleted line", () => {
				const oldContent = "line1\nline2\nline3"
				const newContent = "line1\nline3"
				const filePath = "test.txt"

				const result = generateUnifiedDiff(oldContent, newContent, filePath)

				expect(result).toContain("-line2")
			})
		})
	})

	describe("#given empty old content", () => {
		describe("#when old content is empty string", () => {
			it("#then produces diff showing all lines as added", () => {
				const oldContent = ""
				const newContent = "line1\nline2"
				const filePath = "new-file.txt"

				const result = generateUnifiedDiff(oldContent, newContent, filePath)

				expect(result).toContain("--- new-file.txt")
				expect(result).toContain("+++ new-file.txt")
				expect(result).toContain("+line1")
				expect(result).toContain("+line2")
			})
		})
	})

	describe("#given empty new content", () => {
		describe("#when new content is empty string", () => {
			it("#then produces diff showing all lines as removed", () => {
				const oldContent = "line1\nline2"
				const newContent = ""
				const filePath = "deleted-file.txt"

				const result = generateUnifiedDiff(oldContent, newContent, filePath)

				expect(result).toContain("--- deleted-file.txt")
				expect(result).toContain("+++ deleted-file.txt")
				expect(result).toContain("-line1")
				expect(result).toContain("-line2")
			})
		})
	})

	describe("#given identical content", () => {
		describe("#when old and new content are exactly the same", () => {
			it("#then produces header-only diff with no hunks", () => {
				const oldContent = "line1\nline2\nline3"
				const newContent = "line1\nline2\nline3"
				const filePath = "unchanged.txt"

				const result = generateUnifiedDiff(oldContent, newContent, filePath)

				expect(result).toBe("--- unchanged.txt\n+++ unchanged.txt\n")
				expect(result).not.toContain("@@")
			})
		})
	})

	describe("#given content with trailing newline", () => {
		describe("#when content ends with newline character", () => {
			it("#then handles trailing newline correctly", () => {
				const oldContent = "line1\nline2\n"
				const newContent = "line1\nmodified\n"
				const filePath = "trailing.txt"

				const result = generateUnifiedDiff(oldContent, newContent, filePath)

				expect(result).toContain("-line2")
				expect(result).toContain("+modified")
			})
		})
	})

	describe("#given multi-line changes", () => {
		describe("#when multiple consecutive lines change", () => {
			it("#then groups changes into single hunk", () => {
				const oldContent = "line1\nline2\nline3\nline4"
				const newContent = "line1\nnew2\nnew3\nline4"
				const filePath = "multi.txt"

				const result = generateUnifiedDiff(oldContent, newContent, filePath)

				expect(result).toContain("-line2")
				expect(result).toContain("-line3")
				expect(result).toContain("+new2")
				expect(result).toContain("+new3")
			})
		})
	})

	describe("#given file content containing marker string", () => {
		describe("#when added line contains literal \\ No newline at end of file", () => {
			it("#then preserves the content and does not strip it from diff", () => {
				const oldContent = "line1\n"
				const newContent = "line1\n\\ No newline at end of file\n"
				const filePath = "test.txt"

				const result = generateUnifiedDiff(oldContent, newContent, filePath)


				expect(result).toContain("+\\ No newline at end of file")
			})
		})
	})
	describe("#given filePath with special characters", () => {
		describe("#when filePath contains $ characters", () => {
			it("#then handles $ characters without interpreting them as capture groups", () => {
				const oldContent = "line1\nline2\nline3"
				const newContent = "line1\nmodified\nline3"
				const filePath = "Component$1.js"

				const result = generateUnifiedDiff(oldContent, newContent, filePath)

				// Verify the header contains the correct, unmodified filePath
				expect(result).toContain("--- Component$1.js")
				expect(result).toContain("+++ Component$1.js")
				// Verify the $ character is NOT replaced (corrupted)
				expect(result).not.toContain("--- Component--- .js")
				expect(result).not.toContain("+++ Component+++ .js")
			})
		})

		describe("#when filePath contains multiple $ characters", () => {
			it("#then preserves all $ characters without corruption", () => {
				const oldContent = "line1\nline2"
				const newContent = "line1\nmodified"
				const filePath = "file$$name$&$'$`$1$2.js"

				const result = generateUnifiedDiff(oldContent, newContent, filePath)

				expect(result).toContain(`--- ${filePath}`)
				expect(result).toContain(`+++ ${filePath}`)
				// Verify no corruption occurred
				expect(result).toContain("--- file$$name$&$'$`$1$2.js")
			})
		})
	})

})
