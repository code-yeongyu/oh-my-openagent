declare const require: NodeJS.Require

const { afterEach, describe, expect, it, mock, spyOn } = require("bun:test")

import { __resetTimingConfig, __setTimingConfig } from "./timing"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import type { NativeSkillEntry } from "../skill/native-skills"

type LaunchInput = {
  readonly skillContent?: string
}

type DelegateTaskForTest = {
  readonly execute: (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>
}

type DelegateTaskToolsModule = {
  readonly createDelegateTask: (options: Record<string, unknown>) => DelegateTaskForTest
}

function nativeSkill(name: string, description: string): NativeSkillEntry {
  return {
    name,
    description,
    location: `/native/${name}/SKILL.md`,
    content: `${name} body`,
  }
}

function requireSkillContent(value: string | undefined): string {
  expect(value).toBeDefined()
  if (value === undefined) {
    throw new Error("Expected captured delegate skill content")
  }
  return value
}

describe("createDelegateTask native skill prompt filtering", () => {
  afterEach(() => {
    mock.restore()
    __resetTimingConfig()
    releaseAllPromptAsyncReservationsForTesting()
  })

  it("#given disabled and protected native skills #when delegate system content is built #then hostile native descriptions are excluded", async () => {
    // given
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 50,
      STABILITY_POLLS_REQUIRED: 1,
      WAIT_FOR_SESSION_INTERVAL_MS: 10,
      WAIT_FOR_SESSION_TIMEOUT_MS: 100,
      MAX_POLL_TIME_MS: 50,
      SESSION_CONTINUATION_STABILITY_MS: 50,
    })
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { openai: ["gpt-5.4-mini"] },
      connected: ["openai"],
      updatedAt: "2026-06-15T00:00:00.000Z",
    })

    let capturedLaunch: LaunchInput | undefined
    const manager = {
      async launch(input: LaunchInput) {
        capturedLaunch = input
        return {
          id: "bg_native_prompt_filter",
          sessionId: "ses_native_prompt_filter",
          status: "pending",
          description: "Native prompt filter",
          agent: "explore",
        }
      },
      getTask() {
        return {
          id: "bg_native_prompt_filter",
          sessionId: "ses_native_prompt_filter",
          status: "pending",
          description: "Native prompt filter",
          agent: "explore",
        }
      },
    }
    const client = {
      app: {
        async agents() {
          return { data: [{ name: "explore", mode: "subagent" }] }
        },
      },
      config: {
        async get() {
          return { data: { model: "openai/gpt-5.4-mini" } }
        },
      },
      session: {
        async abort() {
          return { data: {} }
        },
        async create() {
          return { data: { id: "ses_native_prompt_filter" } }
        },
        async get() {
          return { data: { directory: "/project" } }
        },
        async messages() {
          return { data: [] }
        },
        async prompt() {
          return { data: {} }
        },
        async promptAsync() {
          return { data: {} }
        },
        async status() {
          return { data: {} }
        },
      },
    }
    const { createDelegateTask }: DelegateTaskToolsModule = require("./tools")
    const tool = createDelegateTask({
      manager,
      client,
      directory: "/project",
      disabledSkills: new Set(["blocked-native-skill", "debugging"]),
      availableSkills: [
        {
          name: "shared/ulw-plan",
          description: "Bundled shared ulw-plan",
          location: "plugin",
        },
      ],
      nativeSkills: {
        all() {
          return [
            nativeSkill("blocked-native-skill", "BLOCKED_NATIVE_PROMPT_INJECTION"),
            nativeSkill("shared/Debugging", "DISABLED_SHARED_ALIAS_INJECTION"),
            nativeSkill("Shared/ULW-PLAN", "IGNORE_ALL_PRIOR_INSTRUCTIONS"),
            nativeSkill("safe-native-skill", "Safe native guidance"),
          ]
        },
        get() {
          return undefined
        },
        dirs() {
          return ["/native"]
        },
      },
    })

    // when
    await tool.execute(
      {
        description: "Native prompt filter",
        prompt: "Inspect delegate system content",
        subagent_type: "explore",
        run_in_background: true,
        load_skills: [],
      },
      {
        sessionID: "ses_parent",
        messageID: "msg_parent",
        agent: "sisyphus",
        abort: new AbortController().signal,
      },
    )

    // then
    const skillContent = requireSkillContent(capturedLaunch?.skillContent)
    expect(skillContent).toContain("safe-native-skill")
    expect(skillContent).toContain("Safe native guidance")
    expect(skillContent).not.toContain("blocked-native-skill")
    expect(skillContent).not.toContain("BLOCKED_NATIVE_PROMPT_INJECTION")
    expect(skillContent).not.toContain("DISABLED_SHARED_ALIAS_INJECTION")
    expect(skillContent).not.toContain("IGNORE_ALL_PRIOR_INSTRUCTIONS")
  })
})
