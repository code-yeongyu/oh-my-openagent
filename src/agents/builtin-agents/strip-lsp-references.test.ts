import { describe, test, expect } from "bun:test"
import { stripLspPromptReferences, removeLspLines } from "./strip-lsp-references"
import type { AgentConfig } from "@opencode-ai/sdk"

describe("strip-lsp-references", () => {
  describe("#given stripLspPromptReferences", () => {
    describe("#when lsp is in disabled_mcps", () => {
      test("#then removes lines containing lsp_ from prompt", () => {
        // given
        const config: AgentConfig = {
          model: "test-model",
          prompt: [
            "## Verification",
            "",
            "Run `lsp_diagnostics` on changed files at:",
            "- End of a logical task unit",
            "- Before marking a todo item complete",
            "",
            "### Evidence Requirements",
            "",
            "- **File edit** → `lsp_diagnostics` clean on changed files",
            "- **Build command** → Exit code 0",
            "- **Test run** → Pass",
          ].join("\n"),
        }

        // when
        const result = stripLspPromptReferences(config, ["lsp"])

        // then
        expect(result.prompt).not.toContain("lsp_diagnostics")
        expect(result.prompt).toContain("## Verification")
        expect(result.prompt).toContain("- End of a logical task unit")
        expect(result.prompt).toContain("- **Build command** → Exit code 0")
        expect(result.prompt).toContain("- **Test run** → Pass")
      })

      test("#then handles multiple lsp tool types", () => {
        // given
        const config: AgentConfig = {
          model: "test-model",
          prompt: [
            "Tools available:",
            "- `lsp_find_references`: Map all usages before changes",
            "- `lsp_rename` / `lsp_prepare_rename`: Safe symbol renames",
            "- `grep`: Search files",
            "- `glob`: Find files",
          ].join("\n"),
        }

        // when
        const result = stripLspPromptReferences(config, ["lsp"])

        // then
        expect(result.prompt).not.toContain("lsp_find_references")
        expect(result.prompt).not.toContain("lsp_rename")
        expect(result.prompt).not.toContain("lsp_prepare_rename")
        expect(result.prompt).toContain("- `grep`: Search files")
        expect(result.prompt).toContain("- `glob`: Find files")
      })

      test("#then does not produce triple blank lines", () => {
        // given
        const config: AgentConfig = {
          model: "test-model",
          prompt: [
            "Section A",
            "",
            "Run `lsp_diagnostics` on files",
            "",
            "Section B",
          ].join("\n"),
        }

        // when
        const result = stripLspPromptReferences(config, ["lsp"])

        // then
        expect(result.prompt).not.toContain("\n\n\n")
        expect(result.prompt).toContain("Section A")
        expect(result.prompt).toContain("Section B")
      })

      test("#then returns same reference if no lsp_ found in prompt", () => {
        // given
        const config: AgentConfig = {
          model: "test-model",
          prompt: "No LSP references here at all.",
        }

        // when
        const result = stripLspPromptReferences(config, ["lsp"])

        // then
        expect(result).toBe(config)
      })
    })

    describe("#when lsp is NOT in disabled_mcps", () => {
      test("#then returns config unchanged", () => {
        // given
        const config: AgentConfig = {
          model: "test-model",
          prompt: "Run `lsp_diagnostics` on changed files",
        }

        // when
        const result = stripLspPromptReferences(config, [])

        // then
        expect(result).toBe(config)
        expect(result.prompt).toContain("lsp_diagnostics")
      })

      test("#then preserves prompt when other mcps are disabled", () => {
        // given
        const config: AgentConfig = {
          model: "test-model",
          prompt: "Run `lsp_diagnostics` on changed files",
        }

        // when
        const result = stripLspPromptReferences(config, ["playwright", "exa"])

        // then
        expect(result).toBe(config)
        expect(result.prompt).toContain("lsp_diagnostics")
      })
    })

    describe("#when config has no prompt", () => {
      test("#then returns config unchanged", () => {
        // given
        const config: AgentConfig = {
          model: "test-model",
        }

        // when
        const result = stripLspPromptReferences(config, ["lsp"])

        // then
        expect(result).toBe(config)
      })
    })
  })

  describe("#given removeLspLines", () => {
    test("#then removes only lines containing lsp_", () => {
      // given
      const input = [
        "Line 1: normal",
        "Line 2: has lsp_diagnostics reference",
        "Line 3: normal",
        "Line 4: has lsp_find_references too",
        "Line 5: normal",
      ].join("\n")

      // when
      const result = removeLspLines(input)

      // then
      expect(result).toBe(["Line 1: normal", "Line 3: normal", "Line 5: normal"].join("\n"))
    })

    test("#then collapses triple newlines to double", () => {
      // given
      const input = [
        "Before",
        "",
        "lsp_diagnostics line",
        "",
        "After",
      ].join("\n")

      // when
      const result = removeLspLines(input)

      // then
      expect(result).toBe(["Before", "", "After"].join("\n"))
    })
  })
})
