import { describe, expect, test } from "bun:test"

import { prepareDelegateTaskArgs } from "./tool-argument-preparation"
import type { ToolContextWithMetadata } from "./types"

function createContext(): ToolContextWithMetadata {
  return {
    sessionID: "parent-session",
    messageID: "parent-message",
    agent: "sisyphus",
    abort: new AbortController().signal,
  }
}

describe("prepareDelegateTaskArgs task_id validation", () => {
  test("#given a hallucinated task_id #when preparing #then it is dropped so the call becomes a new delegation", async () => {
    // given - the model invented an agent-name-style slug instead of a session id
    const args = {
      description: "Locate terminology implementation",
      prompt: "Find the terminology_query_sentence implementation",
      subagent_type: "explore",
      task_id: "explore_terminology_query_impl",
      load_skills: [],
    }

    // when
    const prepared = await prepareDelegateTaskArgs(args, createContext())

    // then - the invalid id is discarded rather than routed to the continuation branch
    expect(prepared.task_id).toBeUndefined()
    expect(prepared.subagent_type).toBe("explore")
  })

  test("#given a real session id #when preparing #then it is preserved for continuation", async () => {
    // given
    const args = {
      description: "Continue previous work",
      prompt: "Continue",
      task_id: "ses_continue_test",
      load_skills: [],
    }

    // when
    const prepared = await prepareDelegateTaskArgs(args, createContext())

    // then
    expect(prepared.task_id).toBe("ses_continue_test")
  })

  test("#given an omitted task_id #when preparing #then it stays undefined", async () => {
    // given
    const args = {
      description: "Fresh delegation",
      prompt: "Do work",
      subagent_type: "explore",
      load_skills: [],
    }

    // when
    const prepared = await prepareDelegateTaskArgs(args, createContext())

    // then
    expect(prepared.task_id).toBeUndefined()
  })

  test("#given an empty task_id #when preparing #then it is preserved as-is", async () => {
    // given - empty string is already falsy at the routing check; do not rewrite it
    const args = {
      description: "Empty id",
      prompt: "Do work",
      subagent_type: "explore",
      task_id: "",
      load_skills: [],
    }

    // when
    const prepared = await prepareDelegateTaskArgs(args, createContext())

    // then
    expect(prepared.task_id).toBe("")
  })
})