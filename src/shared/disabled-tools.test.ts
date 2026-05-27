import { describe, test, expect } from "bun:test"

import { filterDisabledTools } from "./disabled-tools"

describe("disabled-tools", () => {
  describe("#given filterDisabledTools", () => {
    const mockTools = {
      grep: { name: "grep", description: "Search files" },
      glob: { name: "glob", description: "Find files" },
      edit: { name: "edit", description: "Edit files" },
      lsp_rename: { name: "lsp_rename", description: "Rename symbol" },
    } as Record<string, any>

    describe("#when disabledTools is undefined", () => {
      test("#then returns the original tools object", () => {
        const result = filterDisabledTools(mockTools, undefined)
        expect(result).toBe(mockTools)
      })
    })

    describe("#when disabledTools is an empty array", () => {
      test("#then returns the original tools object", () => {
        const result = filterDisabledTools(mockTools, [])
        expect(result).toBe(mockTools)
      })
    })

    describe("#when disabledTools contains one tool name", () => {
      test("#then removes only that tool", () => {
        const result = filterDisabledTools(mockTools, ["grep"])
        expect(result).toEqual({
          glob: mockTools.glob,
          edit: mockTools.edit,
          lsp_rename: mockTools.lsp_rename,
        })
        expect(result).not.toHaveProperty("grep")
      })
    })

    describe("#when disabledTools contains multiple tool names", () => {
      test("#then removes all specified tools", () => {
        const result = filterDisabledTools(mockTools, ["grep", "edit"])
        expect(result).toEqual({
          glob: mockTools.glob,
          lsp_rename: mockTools.lsp_rename,
        })
      })
    })

    describe("#when disabledTools contains names not in tools", () => {
      test("#then ignores non-existent tool names", () => {
        const result = filterDisabledTools(mockTools, ["nonexistent", "also_fake"])
        expect(result).toEqual(mockTools)
      })
    })

    describe("#when disabledTools contains all tool names", () => {
      test("#then returns an empty object", () => {
        const result = filterDisabledTools(mockTools, ["grep", "glob", "edit", "lsp_rename"])
        expect(result).toEqual({})
      })
    })

    describe("#when tools is an empty record", () => {
      test("#then returns an empty object", () => {
        const result = filterDisabledTools({}, ["grep"])
        expect(result).toEqual({})
      })
    })

    describe("#when disabledTools has duplicates", () => {
      test("#then handles duplicates gracefully", () => {
        const result = filterDisabledTools(mockTools, ["grep", "grep", "grep"])
        expect(result).toEqual({
          glob: mockTools.glob,
          edit: mockTools.edit,
          lsp_rename: mockTools.lsp_rename,
        })
      })
    })

    describe("#when filtering does not mutate original", () => {
      test("#then original tools object is unchanged", () => {
        const original = { ...mockTools }
        filterDisabledTools(mockTools, ["grep", "edit"])
        expect(mockTools).toEqual(original)
      })
    })
  })
})
