import { describe, expect, test } from "bun:test"
import { createTableFormatterHook } from "./index"

describe("createTableFormatterHook", () => {
  test("should format markdown tables in LLM response", async () => {
    // #given
    const hook = createTableFormatterHook()
    const output = {
      text: `| Name | Age |
|---|---|
| John | 25 |
| Elizabeth | 30 |`,
    }

    // #when
    await hook["experimental.text.complete"]!(
      { sessionID: "s1", messageID: "m1", partID: "p1" },
      output
    )

    // #then
    expect(output.text).toContain("| Name      | Age |")
    expect(output.text).toContain("| Elizabeth | 30  |")
  })

  test("should handle text without tables", async () => {
    // #given
    const hook = createTableFormatterHook()
    const originalText = "Just some regular text without tables"
    const output = { text: originalText }

    // #when
    await hook["experimental.text.complete"]!(
      { sessionID: "s1", messageID: "m1", partID: "p1" },
      output
    )

    // #then
    expect(output.text).toBe(originalText)
  })

  test("should handle multiple tables in single response", async () => {
    // #given
    const hook = createTableFormatterHook()
    const output = {
      text: `First table:

| A | B |
|---|---|
| 111 | 2 |

Second table:

| X | Y |
|---|---|
| a | bbb |`,
    }

    // #when
    await hook["experimental.text.complete"]!(
      { sessionID: "s1", messageID: "m1", partID: "p1" },
      output
    )

    // #then
    expect(output.text).toContain("| A   | B |")
    expect(output.text).toContain("| 111 | 2 |")
    expect(output.text).toContain("| X | Y   |")
    expect(output.text).toContain("| a | bbb |")
  })

  test("should handle CJK characters correctly", async () => {
    // #given
    const hook = createTableFormatterHook()
    const output = {
      text: `| KR | Status |
|---|---|
| KR1 | FP 발생 |
| KR5 | Perfect |`,
    }

    // #when
    await hook["experimental.text.complete"]!(
      { sessionID: "s1", messageID: "m1", partID: "p1" },
      output
    )

    // #then - verify padding occurred (KR padded to width of KR1/KR5, Status column aligned)
    expect(output.text).toContain("| KR  | Status  |")
    expect(output.text).toContain("| KR1 | FP 발생 |")
    expect(output.text).toContain("| KR5 | Perfect |")
  })

  test("should handle emoji correctly", async () => {
    // #given
    const hook = createTableFormatterHook()
    const output = {
      text: `| Status | Desc |
|---|---|
| ✅ Perfect | good |
| ❌ Fail | bad |`,
    }

    // #when
    await hook["experimental.text.complete"]!(
      { sessionID: "s1", messageID: "m1", partID: "p1" },
      output
    )

    // #then - verify emoji width handling and padding
    expect(output.text).toContain("| Status     | Desc |")
    expect(output.text).toContain("| ✅ Perfect | good |")
    expect(output.text).toContain("| ❌ Fail    | bad  |")
  })
})
