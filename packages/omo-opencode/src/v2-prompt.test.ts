import { afterEach, describe, expect, it } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import {
  getMainSessionID,
  setMainSession,
  subagentSessions,
} from "./features/claude-code-session-state"
import {
  applyKeywordInjectionV2,
  clearPromptSessionState,
  detectPromptKeywordsV2,
  isKeywordDetectorEnabled,
  registerPromptV2Hook,
} from "./v2-prompt"

const SESSION_ID = "ses-prompt-test"

describe("v2 prompt keywords", () => {
  afterEach(() => {
    clearPromptSessionState(SESSION_ID)
    subagentSessions.delete(SESSION_ID)
    if (getMainSessionID() === SESSION_ID) setMainSession(undefined)
  })

  it("leaves plain prompts untouched", () => {
    // given a prompt with no keywords
    // when detected
    // then nothing fires
    expect(detectPromptKeywordsV2("refactor the login form", SESSION_ID, {})).toEqual([])
  })

  it("detects ultrawork and injects guidance", () => {
    // given an ultrawork prompt on the main session
    setMainSession(SESSION_ID)
    const detected = detectPromptKeywordsV2("ultrawork: rebuild the cache", SESSION_ID, {})

    // when applied
    // then guidance is appended in v1 shape
    expect(detected.length).toBeGreaterThan(0)
    const text = applyKeywordInjectionV2("ultrawork: rebuild the cache", detected)
    expect(text).toMatch(/^ultrawork: rebuild the cache\n\n---\n\n/)
  })

  it("skips slash commands and disabled hooks", () => {
    // given a slash command and a disabling config
    // when detected
    // then nothing fires and the gate reports disabled
    expect(detectPromptKeywordsV2("/goal show", SESSION_ID, {})).toEqual([])
    expect(isKeywordDetectorEnabled({ disabled_hooks: ["keyword-detector"] })).toBe(false)
    expect(isKeywordDetectorEnabled({})).toBe(true)
  })

  it("skips background sessions", () => {
    // given a tracked subagent session
    subagentSessions.add(SESSION_ID)

    // when detected
    // then nothing fires
    expect(detectPromptKeywordsV2("ultrawork: rebuild the cache", SESSION_ID, {})).toEqual([])
  })

  it("registers a prompt hook that mutates admitted text", async () => {
    // given a fake v2 context capturing the prompt callback
    let captured: ((event: { sessionID: string; prompt: { text: string } }) => void) | undefined
    const ctx = {
      session: {
        hook: async (
          _name: string,
          callback: (event: { sessionID: string; prompt: { text: string } }) => void,
        ) => {
          captured = callback
        },
      },
    }
    setMainSession(SESSION_ID)
    const event = { sessionID: SESSION_ID, prompt: { text: "ultrawork: rebuild the cache" } }

    // when registered and invoked
    await registerPromptV2Hook(ctx as unknown as Plugin.Context, {})
    captured?.(event)

    // then the admitted text carries guidance
    expect(captured).not.toBeUndefined()
    expect(event.prompt.text).toMatch(/\n\n---\n\n/)
  })
})
