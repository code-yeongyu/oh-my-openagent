import { describe, expect, test } from "bun:test"

import { extractSessionIdFromOutput } from "./subagent-session-id"

describe("extractSessionIdFromOutput", () => {
  test("extracts Session ID blocks from background output", () => {
    // given
    const output = `Background task launched.\n\nSession ID: ses_bg_12345`

    // when
    const result = extractSessionIdFromOutput(output)

    // then
    expect(result).toBe("ses_bg_12345")
  })

  test("extracts session_id from task metadata blocks", () => {
    // given
    const output = `Task completed.\n\n<task_metadata>\nsession_id: ses_sync_12345\n</task_metadata>`

    // when
    const result = extractSessionIdFromOutput(output)

    // then
    expect(result).toBe("ses_sync_12345")
  })

  test("extracts hyphenated session IDs from task metadata blocks", () => {
    // given
    const output = `Task completed.\n\n<task_metadata>\nsession_id: ses_auth-flow-123\n</task_metadata>`

    // when
    const result = extractSessionIdFromOutput(output)

    // then
    expect(result).toBe("ses_auth-flow-123")
  })

  test("returns undefined when no session id is present", () => {
    // given
    const output = "Task completed without metadata"

    // when
    const result = extractSessionIdFromOutput(output)

    // then
    expect(result).toBeUndefined()
  })

  test("prefers the session id inside the trailing task_metadata block", () => {
    // given
    const output = `The previous attempt mentioned session_id: ses_wrong_body_123 but that was only context.

<task_metadata>
session_id: ses_real_metadata_456
</task_metadata>`

    // when
    const result = extractSessionIdFromOutput(output)

    // then
    expect(result).toBe("ses_real_metadata_456")
  })

  test("does not let task_metadata parsing bleed into incidental body text after the closing tag", () => {
    // given
    const output = `<task_metadata>
session_id: ses_real_metadata_456
</task_metadata>

debug log: session_id: ses_wrong_body_789`

    // when
    const result = extractSessionIdFromOutput(output)

    // then
    expect(result).toBe("ses_real_metadata_456")
  })
})
