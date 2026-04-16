import { describe, expect, test } from "bun:test"

import { buildTaskMetadataBlock, extractTaskLink, parseTaskMetadataBlock } from "./task-metadata-contract"

describe("buildTaskMetadataBlock", () => {
  test("#given only session id #when building #then it preserves the frozen block format", () => {
    // given
    const link = { sessionId: "ses_abc" }

    // when
    const block = buildTaskMetadataBlock(link)

    // then
    expect(block).toBe("<task_metadata>\nsession_id: ses_abc\n</task_metadata>")
  })

  test("#given extended task metadata #when building #then it emits optional lines in order", () => {
    // given
    const link = {
      sessionId: "ses_bg_123",
      taskId: "bg_123",
      backgroundTaskId: "bg_123",
      agent: "explore",
      category: "quick",
    }

    // when
    const block = buildTaskMetadataBlock(link)

    // then
    expect(block).toBe(
      "<task_metadata>\nsession_id: ses_bg_123\ntask_id: bg_123\nbackground_task_id: bg_123\nsubagent: explore\ncategory: quick\n</task_metadata>"
    )
  })
})

describe("parseTaskMetadataBlock", () => {
  test("#given a task metadata block #when parsing #then it extracts the structured link", () => {
    // given
    const text = "<task_metadata>\nsession_id: ses_sync_123\ntask_id: task_123\nbackground_task_id: bg_123\nsubagent: oracle\ncategory: deep\n</task_metadata>"

    // when
    const parsed = parseTaskMetadataBlock(text)

    // then
    expect(parsed).toEqual({
      sessionId: "ses_sync_123",
      taskId: "task_123",
      backgroundTaskId: "bg_123",
      agent: "oracle",
      category: "deep",
    })
  })

  test("#given text without metadata #when parsing #then it returns an empty link", () => {
    // given
    const text = "Task completed without metadata"

    // when
    const parsed = parseTaskMetadataBlock(text)

    // then
    expect(parsed).toEqual({})
  })
})

describe("extractTaskLink", () => {
  test("#given metadata session aliases #when extracting #then metadata wins over output text", () => {
    // given
    const metadata = {
      sessionID: "ses_meta_123",
      task_id: "task_meta_123",
      background_task_id: "bg_meta_123",
      subagent: "atlas",
      category: "unspecified-high",
    }
    const output = "<task_metadata>\nsession_id: ses_text_456\n</task_metadata>"

    // when
    const extracted = extractTaskLink(metadata, output)

    // then
    expect(extracted).toEqual({
      sessionId: "ses_meta_123",
      taskId: "task_meta_123",
      backgroundTaskId: "bg_meta_123",
      agent: "atlas",
      category: "unspecified-high",
    })
  })

  test("#given missing metadata #when extracting #then it falls back to task metadata text", () => {
    // given
    const output = "Task completed.\n\n<task_metadata>\nsession_id: ses_text_456\nsubagent: oracle\n</task_metadata>"

    // when
    const extracted = extractTaskLink(undefined, output)

    // then
    expect(extracted).toEqual({
      sessionId: "ses_text_456",
      agent: "oracle",
    })
  })

  test("#given explicit session id output #when extracting #then it preserves Session ID compatibility", () => {
    // given
    const output = "Background task launched.\n\nSession ID: ses_bg_789"

    // when
    const extracted = extractTaskLink(undefined, output)

    // then
    expect(extracted).toEqual({ sessionId: "ses_bg_789" })
  })
})
