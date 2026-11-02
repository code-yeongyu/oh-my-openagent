import { describe, test, expect } from "bun:test"
import { parseFrontmatter } from "./frontmatter"

describe("parseFrontmatter", () => {
  // #region backward compatibility
  test.each([
    [
      "parses simple key-value frontmatter",
      `---
description: Test command
agent: build
---
Body content`,
      { description: "Test command", agent: "build" },
      "Body content",
    ],
    [
      "parses boolean values",
      `---
subtask: true
enabled: false
---
Body`,
      { subtask: true, enabled: false },
      "Body",
    ],
  ] as const)("%s", (_label, content, expectedData, expectedBody) => {
    // when
    const result = parseFrontmatter(content)

    // then
    expect(result.data).toEqual(expectedData)
    expect(result.body).toBe(expectedBody)
  })
  // #endregion

  // #region complex YAML (handoffs support)
  test("parses complex array frontmatter (speckit handoffs)", () => {
    // given
    const content = `---
description: Execute planning workflow
handoffs:
  - label: Create Tasks
    agent: speckit.tasks
    prompt: Break the plan into tasks
    send: true
  - label: Create Checklist
    agent: speckit.checklist
    prompt: Create a checklist
---
Workflow instructions`

    interface TestMeta {
      description: string
      handoffs: Array<{ label: string; agent: string; prompt: string; send?: boolean }>
    }

    // when
    const result = parseFrontmatter<TestMeta>(content)

    // then
    expect(result.data.description).toBe("Execute planning workflow")
    expect(result.data.handoffs).toHaveLength(2)
    expect(result.data.handoffs[0].label).toBe("Create Tasks")
    expect(result.data.handoffs[0].agent).toBe("speckit.tasks")
    expect(result.data.handoffs[0].send).toBe(true)
    expect(result.data.handoffs[1].agent).toBe("speckit.checklist")
    expect(result.data.handoffs[1].send).toBeUndefined()
  })

  test("parses nested objects in frontmatter", () => {
    // given
    const content = `---
name: test
config:
  timeout: 5000
  retry: true
  options:
    verbose: false
---
Content`

    interface TestMeta {
      name: string
      config: {
        timeout: number
        retry: boolean
        options: { verbose: boolean }
      }
    }

    // when
    const result = parseFrontmatter<TestMeta>(content)

    // then
    expect(result.data.name).toBe("test")
    expect(result.data.config.timeout).toBe(5000)
    expect(result.data.config.retry).toBe(true)
    expect(result.data.config.options.verbose).toBe(false)
  })
  // #endregion

  // #region edge cases
  test.each([
    ["handles content without frontmatter", "Just body content", {}, "Just body content"],
    [
      "handles empty frontmatter",
      `---
---
Body`,
      {},
      "Body",
    ],
    [
      "handles UTF-8 BOM before frontmatter",
      `\uFEFF---
description: BOM-safe
---
Body`,
      { description: "BOM-safe" },
      "Body",
    ],
    [
      "handles invalid YAML gracefully",
      `---
invalid: yaml: syntax: here
  bad indentation
---
Body`,
      {},
      "Body",
    ],
    [
      "handles frontmatter with only whitespace",
      `---
   
---
Body with whitespace-only frontmatter`,
      {},
      "Body with whitespace-only frontmatter",
    ],
  ] as const)("%s", (_label, content, expectedData, expectedBody) => {
    // when
    const result = parseFrontmatter(content)

    // then
    expect(result.data).toEqual(expectedData)
    expect(result.body).toBe(expectedBody)
  })
  // #endregion

  // #region mixed content
  test.each([
    [
      "preserves multiline body content",
      `---
title: Test
---
Line 1
Line 2

Line 4 after blank`,
      { title: "Test" },
      "Line 1\nLine 2\n\nLine 4 after blank",
    ],
    ["handles CRLF line endings", "---\r\ndescription: Test\r\n---\r\nBody", { description: "Test" }, "Body"],
  ] as const)("%s", (_label, content, expectedData, expectedBody) => {
    // when
    const result = parseFrontmatter(content)

    // then
    expect(result.data).toEqual(expectedData)
    expect(result.body).toBe(expectedBody)
  })
  // #endregion

  // #region extra fields tolerance
  test("allows extra fields beyond typed interface", () => {
    // given
    const content = `---
description: Test command
agent: build
extra_field: should not fail
another_extra:
  nested: value
  array:
    - item1
    - item2
custom_boolean: true
custom_number: 42
---
Body content`

    interface MinimalMeta {
      description: string
      agent: string
    }

    interface FrontmatterWithExtras extends MinimalMeta {
      extra_field: string
      another_extra: { nested: string; array: string[] }
      custom_boolean: boolean
      custom_number: number
    }

    // when
    const result = parseFrontmatter<FrontmatterWithExtras>(content)

    // then
    expect(result.data.description).toBe("Test command")
    expect(result.data.agent).toBe("build")
    expect(result.body).toBe("Body content")
    expect(result.data.extra_field).toBe("should not fail")
    expect(result.data.another_extra).toEqual({ nested: "value", array: ["item1", "item2"] })
    expect(result.data.custom_boolean).toBe(true)
    expect(result.data.custom_number).toBe(42)
  })

  test("extra fields do not interfere with expected fields", () => {
    // given
    const content = `---
description: Original description
unknown_field: extra value
handoffs:
  - label: Task 1
    agent: test.agent
---
Content`

    interface HandoffMeta {
      description: string
      handoffs: Array<{ label: string; agent: string }>
    }

    // when
    const result = parseFrontmatter<HandoffMeta>(content)

    // then
    expect(result.data.description).toBe("Original description")
    expect(result.data.handoffs).toHaveLength(1)
    expect(result.data.handoffs[0].label).toBe("Task 1")
    expect(result.data.handoffs[0].agent).toBe("test.agent")
  })
  // #endregion
})
