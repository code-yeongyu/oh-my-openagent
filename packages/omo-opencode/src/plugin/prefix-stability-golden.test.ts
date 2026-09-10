// Byte-stable prefix golden baselines (scenarios S1/S2/S3 gate).
//
// Pins the byte-stable request prefix: frozen and sorted registry export,
// messages-transform output, S1 retry equality, S2 model-switch determinism.
// Fixtures live in testdata/golden/ next to this file.
//
// Regen gate: UPDATE_GOLDEN=1 (and ONLY then). Rewrite with
//   UPDATE_GOLDEN=1 bun test packages/omo-opencode/src/plugin/prefix-stability-golden.test.ts
// then inspect the diff before committing: ordering and normalization churn
// only, never content loss. Runs without the flag compare bytes and fail on
// any drift.

import { beforeEach, describe, expect, mock, test } from "bun:test"
import path from "node:path"
import { tool } from "@opencode-ai/plugin"
import type { Message, Part } from "@opencode-ai/sdk"

import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "../config"
import { getUltraworkMessage } from "../hooks/keyword-detector/ultrawork"
import { stableStringify } from "../shared/stable-stringify"
import { createMessagesTransformHandler } from "./messages-transform"
import {
  clearModelIdentityPinCaches,
  pinnedUltraworkMessage,
} from "./model-identity-pin"
import { clearToolRegistryCache, createToolRegistry } from "./tool-registry"

const GOLDEN_DIR = path.join(import.meta.dir, "testdata/golden")
const UPDATE = process.env.UPDATE_GOLDEN === "1"

const GOLDEN_SESSION = "ses-prefix-golden"
const GPT_MODEL = "openai/gpt-5.5"
const GEMINI_MODEL = "google/gemini-3.1-pro"

async function assertGolden(filename: string, actual: string): Promise<void> {
  const file = path.join(GOLDEN_DIR, filename)
  if (UPDATE) {
    await Bun.write(file, actual)
    return
  }
  const expected = await Bun.file(file).text()
  expect(actual).toBe(expected)
}

function goldenBytes(value: unknown): string {
  return `${stableStringify(value)}\n`
}

const fakeTool = tool({
  description: "golden tool",
  args: {},
  async execute(): Promise<string> {
    return "ok"
  },
})

function buildGoldenToolFactories(): NonNullable<
  Parameters<typeof createToolRegistry>[0]["toolFactories"]
> {
  return {
    createBackgroundTools: mock(() => ({})),
    createCallOmoAgent: mock(() => fakeTool),
    createLookAt: mock(() => fakeTool),
    createSkillMcpTool: mock(() => fakeTool),
    createSkillTool: mock(() => fakeTool),
    createGrepTools: mock(() => ({})),
    createGlobTools: mock(() => ({})),
    createSessionManagerTools: mock(() => ({})),
    createDelegateTask: mock(() => fakeTool),
    discoverCommandsSync: mock(() => []),
    interactive_bash: fakeTool,
    createTaskCreateTool: mock(() => fakeTool),
    createTaskGetTool: mock(() => fakeTool),
    createTaskList: mock(() => fakeTool),
    createTaskUpdateTool: mock(() => fakeTool),
    createHashlineEditTool: mock(() => fakeTool),
    createTeamApproveShutdownTool: mock(() => fakeTool),
    createTeamCreateTool: mock(() => fakeTool),
    createTeamDeleteTool: mock(() => fakeTool),
    createTeamRejectShutdownTool: mock(() => fakeTool),
    createTeamShutdownRequestTool: mock(() => fakeTool),
    createTeamSendMessageTool: mock(() => fakeTool),
    createTeamTaskCreateTool: mock(() => fakeTool),
    createTeamTaskGetTool: mock(() => fakeTool),
    createTeamTaskListTool: mock(() => fakeTool),
    createTeamTaskUpdateTool: mock(() => fakeTool),
    createTeamStatusTool: mock(() => fakeTool),
    createTeamListTool: mock(() => fakeTool),
  }
}

function goldenPluginConfig(): OhMyOpenCodeConfig {
  return OhMyOpenCodeConfigSchema.parse({
    git_master: {
      commit_footer: false,
      include_co_authored_by: false,
      git_env_prefix: "",
    },
  })
}

function buildRegistryExport(): Record<string, string> {
  const result = createToolRegistry({
    ctx: { directory: "/tmp" } as Parameters<typeof createToolRegistry>[0]["ctx"],
    pluginConfig: goldenPluginConfig(),
    managers: {
      backgroundManager: {},
      tmuxSessionManager: {},
      skillMcpManager: {},
    } as Parameters<typeof createToolRegistry>[0]["managers"],
    skillContext: {
      mergedSkills: [],
      availableSkills: [],
      browserProvider: "playwright",
      disabledSkills: new Set(),
    } as unknown as Parameters<typeof createToolRegistry>[0]["skillContext"],
    availableCategories: [],
    interactiveBashEnabled: false,
    toolFactories: buildGoldenToolFactories(),
    sessionID: GOLDEN_SESSION,
  })
  const names = Object.keys(result.filteredTools)
  expect(names).toEqual([...names].sort())
  return Object.fromEntries(
    names.map((name) => [name, String(result.filteredTools[name]?.description ?? "")]),
  )
}

function userMessage(input: { id: string }): Message {
  return {
    id: input.id,
    sessionID: GOLDEN_SESSION,
    role: "user",
    time: { created: 1 },
    agent: "sisyphus",
    model: { providerID: "test-provider", modelID: "test-model" },
  }
}

function assistantMessage(input: { id: string }): Message {
  return {
    id: input.id,
    sessionID: GOLDEN_SESSION,
    role: "assistant",
    time: { created: 2 },
    parentID: "msg_parent",
    modelID: "test-model",
    providerID: "test-provider",
    mode: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  }
}

function textPart(input: { id: string; messageID: string; text: string }): Part {
  return {
    id: input.id,
    sessionID: GOLDEN_SESSION,
    messageID: input.messageID,
    type: "text",
    text: input.text,
  }
}

function goldenPayload(): { messages: { info: Message; parts: Part[] }[] } {
  return {
    messages: [
      {
        info: userMessage({ id: "msg_user_golden" }),
        parts: [textPart({
          id: "part_user_golden",
          messageID: "msg_user_golden",
          text: "golden hello",
        })],
      },
      {
        info: assistantMessage({ id: "msg_assistant_golden" }),
        parts: [textPart({
          id: "part_assistant_golden",
          messageID: "msg_assistant_golden",
          text: "done",
        })],
      },
    ],
  }
}

async function buildTransformBytes(): Promise<string> {
  // given
  const handler = createMessagesTransformHandler({ hooks: {} })
  const output = goldenPayload()

  // when
  await handler({}, output)

  // then: neutral model ids never trigger prefill repair, so the transform
  // is a pure pass-through and the bytes are clock-independent
  expect(output.messages).toHaveLength(2)
  return goldenBytes(output)
}

beforeEach(() => {
  clearToolRegistryCache()
  clearModelIdentityPinCaches()
})

describe("#given the byte-stable prefix goldens", () => {
  test("#when exporting the registry #then bytes equal the fixture", async () => {
    //#given
    const actual = goldenBytes(buildRegistryExport())

    //#when
    await assertGolden("registry_export.json", actual)

    //#then
    expect(actual.endsWith("\n")).toBe(true)
  })

  test("#when running messages-transform #then bytes equal the fixture", async () => {
    //#given
    const actual = await buildTransformBytes()

    //#when
    await assertGolden("messages_transform.json", actual)

    //#then
    expect(actual.endsWith("\n")).toBe(true)
  })
})

describe("#given scenario S1 (retry same session and model)", () => {
  test("#when exporting the registry twice #then both exports are byte-identical", () => {
    //#given
    const first = goldenBytes(buildRegistryExport())

    //#when
    const second = goldenBytes(buildRegistryExport())

    //#then
    expect(second).toBe(first)
  })

  test("#when running messages-transform twice #then both outputs are byte-identical", async () => {
    //#given
    const first = await buildTransformBytes()

    //#when
    const second = await buildTransformBytes()

    //#then
    expect(second).toBe(first)
  })

  test("#when resolving the ultrawork message twice #then bytes are identical and compute runs once", () => {
    //#given
    let calls = 0
    const compute = (): string => {
      calls += 1
      return getUltraworkMessage("sisyphus", GPT_MODEL)
    }
    const identity = { sessionID: GOLDEN_SESSION, agentName: "sisyphus", modelID: GPT_MODEL }

    //#when
    const first = pinnedUltraworkMessage(identity, compute)
    const second = pinnedUltraworkMessage(identity, compute)

    //#then
    expect(second).toBe(first)
    expect(calls).toBe(1)
  })
})

describe("#given scenario S2 (model switch)", () => {
  test("#when switching models #then bytes change deterministically and repeats pin", async () => {
    //#given
    const gptIdentity = { sessionID: GOLDEN_SESSION, agentName: "sisyphus", modelID: GPT_MODEL }
    const geminiIdentity = { sessionID: GOLDEN_SESSION, agentName: "sisyphus", modelID: GEMINI_MODEL }

    //#when
    const gptFirst = pinnedUltraworkMessage(gptIdentity, () => getUltraworkMessage("sisyphus", GPT_MODEL))
    const geminiFirst = pinnedUltraworkMessage(geminiIdentity, () =>
      getUltraworkMessage("sisyphus", GEMINI_MODEL),
    )
    const gptSecond = pinnedUltraworkMessage(gptIdentity, () => getUltraworkMessage("sisyphus", GPT_MODEL))
    const geminiSecond = pinnedUltraworkMessage(geminiIdentity, () =>
      getUltraworkMessage("sisyphus", GEMINI_MODEL),
    )

    //#then
    expect(geminiFirst).not.toBe(gptFirst)
    expect(gptSecond).toBe(gptFirst)
    expect(geminiSecond).toBe(geminiFirst)
    await assertGolden("model_switch.json", goldenBytes({ gemini: geminiFirst, gpt: gptFirst }))
  })
})
