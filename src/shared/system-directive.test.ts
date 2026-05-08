import { describe, expect, test } from "bun:test"
import {
  hasSystemReminder,
  removeSystemReminders,
  isSystemDirective,
  createSystemDirective,
  containsSystemDirective,
  LEGACY_SYSTEM_DIRECTIVE_PREFIX,
  SYSTEM_DIRECTIVE_PREFIX,
} from "./system-directive"

describe("system-directive utilities", () => {
  describe("hasSystemReminder", () => {
    test("should return true for messages containing <system-reminder> tags", () => {
      const text = `<system-reminder>
Some system content
</system-reminder>`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should return false for messages without system-reminder tags", () => {
      const text = "Just a normal user message"
      expect(hasSystemReminder(text)).toBe(false)
    })

    test("should be case-insensitive for tag names", () => {
      const text = `<SYSTEM-REMINDER>content</SYSTEM-REMINDER>`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should detect system-reminder in mixed content", () => {
      const text = `User text here
<system-reminder>
System content
</system-reminder>
More user text`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should handle empty system-reminder tags", () => {
      const text = `<system-reminder></system-reminder>`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should handle multiline system-reminder content", () => {
      const text = `<system-reminder>
Line 1
Line 2
Line 3
</system-reminder>`
      expect(hasSystemReminder(text)).toBe(true)
    })
  })

  describe("removeSystemReminders", () => {
    test("should remove system-reminder tags and content", () => {
      const text = `<system-reminder>
System content that should be removed
</system-reminder>`
      expect(removeSystemReminders(text)).toBe("")
    })

    test("should preserve user text outside system-reminder tags", () => {
      const text = `User message here
<system-reminder>
System content to remove
</system-reminder>
More user text`
      const result = removeSystemReminders(text)
      expect(result).toContain("User message here")
      expect(result).toContain("More user text")
      expect(result).not.toContain("System content to remove")
    })

    test("should remove multiple system-reminder blocks", () => {
      const text = `<system-reminder>First block</system-reminder>
User text
<system-reminder>Second block</system-reminder>`
      const result = removeSystemReminders(text)
      expect(result).toContain("User text")
      expect(result).not.toContain("First block")
      expect(result).not.toContain("Second block")
    })

    test("should be case-insensitive for tag names", () => {
      const text = `<SYSTEM-REMINDER>Content</SYSTEM-REMINDER>`
      expect(removeSystemReminders(text)).toBe("")
    })

    test("should handle nested tags correctly", () => {
      const text = `<system-reminder>
Outer content
<inner>Some inner tag</inner>
</system-reminder>`
      expect(removeSystemReminders(text)).toBe("")
    })

    test("should trim whitespace from result", () => {
      const text = `
<system-reminder>Remove this</system-reminder>

User text

`
      const result = removeSystemReminders(text)
      expect(result).toBe("User text")
    })

    test("should handle empty string input", () => {
      expect(removeSystemReminders("")).toBe("")
    })

    test("should handle text with no system-reminder tags", () => {
      const text = "Just normal user text without any system reminders"
      expect(removeSystemReminders(text)).toBe(text)
    })

    test("should preserve code blocks in user text", () => {
      const text = `Here's some code:
\`\`\`javascript
const x = 1;
\`\`\`
<system-reminder>System info</system-reminder>`
      const result = removeSystemReminders(text)
      expect(result).toContain("Here's some code:")
      expect(result).toContain("```javascript")
      expect(result).not.toContain("System info")
    })
  })

  describe("isSystemDirective", () => {
    test("should return true for OH-MY-OPENCODE system directives", () => {
      const directive = createSystemDirective("TEST")
      expect(isSystemDirective(directive)).toBe(true)
    })

    test("should return false for system-reminder tags", () => {
      const text = `<system-reminder>content</system-reminder>`
      expect(isSystemDirective(text)).toBe(false)
    })

    test("should return false for normal user messages", () => {
      expect(isSystemDirective("Just a normal message")).toBe(false)
    })

    test("should handle leading whitespace", () => {
      const directive = `  ${createSystemDirective("TEST")}`
      expect(isSystemDirective(directive)).toBe(true)
    })

    test("#given a ralph-loop ULW continuation prefixed with 'ultrawork ' #when checking system directive #then returns true", () => {
      // given
      const directive = `ultrawork ${createSystemDirective("RALPH LOOP 2/500")}\n\nYour previous attempt did not output the completion promise.`

      // when
      const result = isSystemDirective(directive)

      // then
      expect(result).toBe(true)
    })

    test("#given a continuation prefixed with 'ulw ' shorthand #when checking system directive #then returns true", () => {
      // given
      const directive = `ulw ${createSystemDirective("ULTRAWORK LOOP VERIFICATION 1/500")}\n\nYou already emitted <promise>DONE</promise>.`

      // when
      const result = isSystemDirective(directive)

      // then
      expect(result).toBe(true)
    })

    test("#given a continuation prefixed with uppercase 'ULTRAWORK ' #when checking system directive #then returns true", () => {
      // given
      const directive = `ULTRAWORK ${createSystemDirective("RALPH LOOP 5/500")}`

      // when
      const result = isSystemDirective(directive)

      // then
      expect(result).toBe(true)
    })

    test("#given user text that legitimately starts with 'ultrawork' word #when no directive follows #then returns false", () => {
      // given
      const text = "ultrawork is a great mode but I have a question about it"

      // when
      const result = isSystemDirective(text)

      // then
      expect(result).toBe(false)
    })

    test("#given a directive minted with the legacy OH-MY-OPENCODE prefix #when checking #then returns true (issue #3435)", () => {
      // given: in-flight session whose directive was minted before the prefix rename
      const directive = `${LEGACY_SYSTEM_DIRECTIVE_PREFIX} - SINGLE TASK ONLY]\n\nbody`

      // when
      const result = isSystemDirective(directive)

      // then
      expect(result).toBe(true)
    })

    test("#given a directive minted with the new OMO prefix #when checking #then returns true (issue #3435)", () => {
      // given: directive created after the rename
      const directive = createSystemDirective("SINGLE TASK ONLY")
      expect(directive.startsWith(SYSTEM_DIRECTIVE_PREFIX)).toBe(true)

      // when
      const result = isSystemDirective(directive)

      // then
      expect(result).toBe(true)
    })
  })

  describe("containsSystemDirective", () => {
    test("#given prompt that already includes the new prefix anywhere #when checking #then returns true (issue #3435)", () => {
      // given: another guard previously appended a directive somewhere in the body
      const prompt = `Some preamble\n${createSystemDirective("NOTEPAD INJECTION")}\nrest of prompt`

      // when
      const result = containsSystemDirective(prompt)

      // then
      expect(result).toBe(true)
    })

    test("#given prompt that includes the legacy prefix anywhere #when checking #then returns true (issue #3435)", () => {
      // given: in-flight session whose prompt still carries the OH-MY-OPENCODE marker
      const prompt = `User prompt\n[SYSTEM DIRECTIVE: OH-MY-OPENCODE - SINGLE TASK ONLY]\nrest`

      // when
      const result = containsSystemDirective(prompt)

      // then: legacy detection MUST still trip, otherwise hooks would double-inject
      expect(result).toBe(true)
    })

    test("#given prompt with no system directive markers #when checking #then returns false", () => {
      // given
      const prompt = "Plain user prompt with no oh-my-opencode directives"

      // when
      const result = containsSystemDirective(prompt)

      // then
      expect(result).toBe(false)
    })
  })

  describe("integration with keyword detection", () => {
    test("should prevent search keywords in system-reminders from triggering mode", () => {
      const text = `<system-reminder>
The system will search for the file and find all occurrences.
Please locate and scan the directory.
</system-reminder>`

      // After removing system reminders, no search keywords should remain
      const cleanText = removeSystemReminders(text)
      expect(cleanText).not.toMatch(/\b(search|find|locate|scan)\b/i)
    })

    test("should preserve search keywords in user text while removing system-reminder keywords", () => {
      const text = `<system-reminder>
System will find and locate files.
</system-reminder>

Please search for the bug in the code.`

      const cleanText = removeSystemReminders(text)
      expect(cleanText).toContain("search")
      expect(cleanText).not.toContain("find and locate")
    })

    test("should handle complex mixed content with multiple modes", () => {
      const text = `<system-reminder>
System will search and investigate.
</system-reminder>

User wants to explore the codebase and analyze the implementation.

<system-reminder>
Another system reminder with research keyword.
</system-reminder>`

      const cleanText = removeSystemReminders(text)
      expect(cleanText).toContain("explore")
      expect(cleanText).toContain("analyze")
      expect(cleanText).not.toContain("search and investigate")
      expect(cleanText).not.toContain("research")
    })
  })
})
