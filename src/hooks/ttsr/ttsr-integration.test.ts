/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { TtsrRule, TtsrSettings } from "../../features/ttsr/types"
import { createAbortRetryHandler } from "./abort-retry-handler"
import { createTtsrHook, type TtsrHook } from "./hook"
import { discoverTtsrRules } from "./rule-discovery"
const defaultSettings: TtsrSettings = {
  enabled: true,
  contextMode: "discard",
  interruptMode: "always",
  repeatMode: "once",
  repeatGap: 0,
  maxRetriesPerRule: 3,
}

interface IntegratedHookOptions {
  condition: string
  content: string
  settings?: TtsrSettings
  markInjectedOnMatch?: boolean
}

const createRuleMarkdown = (condition: string, content: string): string => `---
condition: '${condition}'
---
${content}
`

describe("TTSR integration", () => {
  let tempRoot = ""
  let tempHome = ""
  let originalHome = ""

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ttsr-integration-project-"))
    tempHome = await mkdtemp(join(tmpdir(), "ttsr-integration-home-"))
    originalHome = process.env.HOME ?? ""
    process.env.HOME = tempHome
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await rm(tempRoot, { recursive: true, force: true })
    await rm(tempHome, { recursive: true, force: true })
  })

  const discoverOneRule = async (condition: string, content: string): Promise<TtsrRule> => {
    const rulesDir = join(tempRoot, ".claude", "rules")
    const rulePath = join(rulesDir, "integration-rule.md")
    await mkdir(rulesDir, { recursive: true })
    await Bun.write(rulePath, createRuleMarkdown(condition, content))

    const rules = await discoverTtsrRules(tempRoot)
    expect(rules).toHaveLength(1)
    const discoveredRule = rules[0]
    if (!discoveredRule) {
      throw new Error("Expected one discovered TTSR rule")
    }
    return discoveredRule
  }

  const createIntegratedHook = async ({
    condition,
    content,
    settings = defaultSettings,
    markInjectedOnMatch = false,
  }: IntegratedHookOptions) => {
    const rule = await discoverOneRule(condition, content)
    const abort = mock((_sessionID: string) => Promise.resolve())
    const promptAsync = mock((_sessionID: string, _content: string) => Promise.resolve())
    const abortRetryHandler = createAbortRetryHandler({ abort, promptAsync })

    let hookRef: TtsrHook | undefined
    const hook = createTtsrHook({
      settings,
      rules: [rule],
      onMatch: async (sessionID, matchedRules) => {
        await abortRetryHandler.handleMatches(sessionID, matchedRules, settings)
        if (markInjectedOnMatch) {
          hookRef?.getManager(sessionID)?.markInjected(matchedRules.map((matchedRule) => matchedRule.name))
        }
      },
    })
    hookRef = hook

    return { hook, abort, promptAsync }
  }

  describe("#given discovered rule and wired abort-retry handler", () => {
    describe("#when matching assistant text arrives", () => {
      describe("#then abort and promptAsync are triggered", () => {
        it("calls abort and injects a system-interrupt prompt", async () => {
          const { hook, abort, promptAsync } = await createIntegratedHook({
            condition: "multi_tool_use\\.parallel",
            content: "Use real tool calls instead of plain text tool syntax.",
          })

          await hook.handleEvent({ type: "session.created" }, { info: { id: "ses_integration" } })
          await hook.handleEvent(
            { type: "message.part.updated" },
            {
              info: {
                sessionID: "ses_integration",
                role: "assistant",
                part: { id: "p1", type: "text", text: "to=multi_tool_use.parallel" },
              },
            }
          )

          expect(abort).toHaveBeenCalledTimes(1)
          const abortCall = abort.mock.calls[0]
          if (!abortCall) {
            throw new Error("Expected abort to be called")
          }
          expect(abortCall[0]).toBe("ses_integration")

          expect(promptAsync).toHaveBeenCalledTimes(1)
          const promptCall = promptAsync.mock.calls[0]
          if (!promptCall) {
            throw new Error("Expected promptAsync to be called")
          }
          expect(promptCall[0]).toBe("ses_integration")
          expect(promptCall[1]).toContain("<system-interrupt")
        })
      })
    })
  })

  describe("#given a discovered rule", () => {
    describe("#when assistant text does not match", () => {
      describe("#then abort-retry is not triggered", () => {
        it("does not call abort or promptAsync", async () => {
          const { hook, abort, promptAsync } = await createIntegratedHook({
            condition: "multi_tool_use\\.parallel",
            content: "Use real tool calls instead of plain text tool syntax.",
          })

          await hook.handleEvent({ type: "session.created" }, { info: { id: "ses_no_match" } })
          await hook.handleEvent(
            { type: "message.part.updated" },
            {
              info: {
                sessionID: "ses_no_match",
                role: "assistant",
                part: { id: "p1", type: "text", text: "normal assistant response" },
              },
            }
          )

          expect(abort).not.toHaveBeenCalled()
          expect(promptAsync).not.toHaveBeenCalled()
        })
      })
    })
  })

  describe("#given repeatMode once", () => {
    describe("#when the same pattern appears in a later message turn", () => {
      describe("#then second match does not re-trigger abort-retry", () => {
        it("calls abort exactly once", async () => {
          const { hook, abort, promptAsync } = await createIntegratedHook({
            condition: "bad-pattern",
            content: "Do not emit bad-pattern.",
            settings: { ...defaultSettings, repeatMode: "once" },
            markInjectedOnMatch: true,
          })

          await hook.handleEvent({ type: "session.created" }, { info: { id: "ses_once" } })
          await hook.handleEvent(
            { type: "message.part.updated" },
            {
              info: {
                sessionID: "ses_once",
                role: "assistant",
                part: { id: "p1", type: "text", text: "bad-pattern" },
              },
            }
          )
          await hook.handleEvent({ type: "message.updated" }, { info: { sessionID: "ses_once" } })
          await hook.handleEvent(
            { type: "message.part.updated" },
            {
              info: {
                sessionID: "ses_once",
                role: "assistant",
                part: { id: "p2", type: "text", text: "bad-pattern" },
              },
            }
          )

          expect(abort).toHaveBeenCalledTimes(1)
          expect(promptAsync).toHaveBeenCalledTimes(1)
        })
      })
    })
  })
})
