import { describe, expect, it } from "bun:test"
import { formatMetaYaml, type MetaMember } from "./meta-yaml-formatter"

const baseMember: MetaMember = {
  task_id: "task-123",
  member: "Oracle",
  member_slug: "oracle",
  task_output_path: "/tmp/oracle-output.txt",
  archive_file: "oracle.md",
  has_response: true,
  response_complete: true,
}

describe("formatMetaYaml", () => {
  describe("#given archive name, created_at, and a single member with all fields", () => {
    it("#then formats basic YAML with archive_name, created_at, members block", () => {
      const result = formatMetaYaml("my-council", "2026-03-02T10:00:00Z", [baseMember])

      expect(result).toContain("archive_name: my-council")
      expect(result).toContain("created_at: 2026-03-02T10:00:00Z")
      expect(result).toContain("members:")
      expect(result).toContain("  - task_id: task-123")
      expect(result).toContain('    member: "Oracle"')
      expect(result).toContain("    member_slug: oracle")
      expect(result).toContain("    task_output_path: /tmp/oracle-output.txt")
      expect(result).toContain("    archive_file: oracle.md")
      expect(result).toContain("    has_response: true")
      expect(result).toContain("    response_complete: true")
    })
  })

  describe("#given multiple members", () => {
    it("#then formats each member correctly in sequence", () => {
      const secondMember: MetaMember = {
        task_id: "task-456",
        member: "Librarian",
        member_slug: "librarian",
        task_output_path: "/tmp/librarian-output.txt",
        archive_file: "librarian.md",
        has_response: false,
        response_complete: false,
      }

      const result = formatMetaYaml("multi-council", "2026-03-02T10:00:00Z", [baseMember, secondMember])

      expect(result).toContain("  - task_id: task-123")
      expect(result).toContain('    member: "Oracle"')
      expect(result).toContain("  - task_id: task-456")
      expect(result).toContain('    member: "Librarian"')
    })
  })

  describe("#given optional question field provided", () => {
    it("#then includes question as block scalar with indented lines", () => {
      const result = formatMetaYaml("q-council", "2026-03-02T10:00:00Z", [baseMember], "What is the best approach?")

      expect(result).toContain("question: |")
      expect(result).toContain("  What is the best approach?")
    })
  })

  describe("#given multi-line question", () => {
    it("#then indents each line with 2 spaces", () => {
      const question = "Line one\nLine two\nLine three"
      const result = formatMetaYaml("ml-council", "2026-03-02T10:00:00Z", [baseMember], question)

      expect(result).toContain("question: |")
      expect(result).toContain("  Line one")
      expect(result).toContain("  Line two")
      expect(result).toContain("  Line three")
    })
  })

  describe("#given optional promptFile field provided", () => {
    it("#then includes prompt_file line in output", () => {
      const result = formatMetaYaml("pf-council", "2026-03-02T10:00:00Z", [baseMember], undefined, "/tmp/prompt.md")

      expect(result).toContain("prompt_file: /tmp/prompt.md")
    })
  })

  describe("#given both question and promptFile provided", () => {
    it("#then includes both question block and prompt_file line", () => {
      const result = formatMetaYaml(
        "full-council",
        "2026-03-02T10:00:00Z",
        [baseMember],
        "What should we do?",
        "/tmp/prompt.md",
      )

      expect(result).toContain("question: |")
      expect(result).toContain("  What should we do?")
      expect(result).toContain("prompt_file: /tmp/prompt.md")
    })
  })

  describe("#given empty members array", () => {
    it("#then includes members: key with no member entries", () => {
      const result = formatMetaYaml("empty-council", "2026-03-02T10:00:00Z", [])

      expect(result).toContain("members:")
      expect(result).not.toContain("  - task_id:")
    })
  })

  describe("#given member with has_response false and response_complete false", () => {
    it("#then renders boolean false values correctly", () => {
      const member: MetaMember = { ...baseMember, has_response: false, response_complete: false }
      const result = formatMetaYaml("bool-council", "2026-03-02T10:00:00Z", [member])

      expect(result).toContain("    has_response: false")
      expect(result).toContain("    response_complete: false")
    })
  })

  describe("#given member with has_response true and response_complete true", () => {
    it("#then renders boolean true values correctly", () => {
      const result = formatMetaYaml("bool-true-council", "2026-03-02T10:00:00Z", [baseMember])

      expect(result).toContain("    has_response: true")
      expect(result).toContain("    response_complete: true")
    })
  })

  describe("#given member field with special characters", () => {
    it("#then wraps member name in double quotes", () => {
      const member: MetaMember = { ...baseMember, member: "Hephaestus" }
      const result = formatMetaYaml("quote-council", "2026-03-02T10:00:00Z", [member])

      expect(result).toContain('    member: "Hephaestus"')
    })
  })

  describe("#given any valid input", () => {
    it("#then output ends with a trailing newline", () => {
      const result = formatMetaYaml("newline-council", "2026-03-02T10:00:00Z", [baseMember])

      expect(result.endsWith("\n")).toBe(true)
    })
  })

  describe("#given full output structure verification", () => {
    it("#then produces exact expected YAML string", () => {
      const result = formatMetaYaml("exact-council", "2026-03-02T10:00:00Z", [baseMember])

      const expected = [
        "archive_name: exact-council",
        "created_at: 2026-03-02T10:00:00Z",
        "members:",
        "  - task_id: task-123",
        '    member: "Oracle"',
        "    member_slug: oracle",
        "    task_output_path: /tmp/oracle-output.txt",
        "    archive_file: oracle.md",
        "    has_response: true",
        "    response_complete: true",
      ].join("\n") + "\n"

      expect(result).toBe(expected)
    })
  })
})
