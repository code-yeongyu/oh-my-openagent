import { describe, expect, test } from "bun:test"
import {
  hasSystemReminder,
  removeSystemReminders,
  isSystemDirective,
  createSystemDirective,
  containsSystemDirective,
  SYSTEM_DIRECTIVE_PREFIX,
  SystemDirectiveTypes,
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
    test("should return true for generated system directives", () => {
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
  })

  describe("outbound payload filter safety (#3435)", () => {
    test("#given the shipped directive prefix #when checked against the Anthropic trigger literal #then it carries no 'opencode' substring", () => {
      // given
      const prefix = SYSTEM_DIRECTIVE_PREFIX

      // when
      const lowered = prefix.toLowerCase()

      // then
      expect(lowered).not.toContain("opencode")
    })

    test("#given every directive type #when a directive is created for outbound injection #then the payload carries no 'opencode' substring", () => {
      // given
      const types = Object.values(SystemDirectiveTypes)

      // when
      const payloads = types.map((type) => createSystemDirective(type))

      // then
      for (const payload of payloads) {
        expect(payload.toLowerCase()).not.toContain("opencode")
      }
    })

    test("#given directives in current and legacy formats #when checking recognition #then both are recognized so in-flight sessions keep working", () => {
      // given
      const current = createSystemDirective("RALPH LOOP 2/500")
      const legacy = "[SYSTEM DIRECTIVE: OH-MY-OPENCODE - RALPH LOOP 2/500]\ncontinue"
      const legacyWithKeyword = `ultrawork [SYSTEM DIRECTIVE: OH-MY-OPENCODE - RALPH LOOP 2/500]\ncontinue`

      // when
      const results = [isSystemDirective(current), isSystemDirective(legacy), isSystemDirective(legacyWithKeyword)]

      // then
      expect(results).toEqual([true, true, true])
    })

    test("#given prompts containing current or legacy directives #when checking containment #then both are detected for double-injection guards", () => {
      // given
      const withCurrent = `task prompt\n${createSystemDirective("SINGLE TASK ONLY")}`
      const withLegacy = "[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION]\nresume"

      // when
      const results = [containsSystemDirective(withCurrent), containsSystemDirective(withLegacy), containsSystemDirective("plain user prompt")]

      // then
      expect(results).toEqual([true, true, false])
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
