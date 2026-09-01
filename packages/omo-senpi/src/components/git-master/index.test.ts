/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { OmoGitMasterSettingsSchema, type OmoGitMasterSettings } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createGitMasterAttributionComponent } from "./index"

const CO_AUTHOR_TRAILER = "Co-authored-by: sisyphus-dev-ai <sisyphus-dev-ai@users.noreply.github.com>"

function createTestContext(pi: FakeExtensionAPI): ComponentContext {
  const logger: ComponentLogger = {
    info() {},
    warn() {},
    error() {},
  }
  return {
    logger,
    config: {
      getFlag(name) {
        return pi.getFlag(name)
      },
    },
  }
}

function readResultPayload(filePath: string, isError = false): Record<string, unknown> {
  return {
    type: "tool_result",
    toolCallId: "tc-read-1",
    toolName: "read",
    input: { file_path: filePath },
    content: [{ type: "text", text: "# Git Master\n\nMode Gate..." }],
    isError,
    details: {},
  }
}

interface ToolResultTransform {
  content: ReadonlyArray<{ type: string; text?: string }>
}

async function dispatchRead(
  pi: FakeExtensionAPI,
  payload: Record<string, unknown>,
): Promise<ToolResultTransform | undefined> {
  const [result] = await pi.dispatch("tool_result", payload)
  return result as ToolResultTransform | undefined
}

function appendedTextOf(transform: ToolResultTransform): string {
  const last = transform.content[transform.content.length - 1]
  return typeof last?.text === "string" ? last.text : ""
}

async function registerWithSettings(
  pi: FakeExtensionAPI,
  settings: OmoGitMasterSettings,
): Promise<void> {
  const component = createGitMasterAttributionComponent({ loadSettings: () => settings })
  await component.register(pi, createTestContext(pi))
}

const defaultSettings = (): OmoGitMasterSettings => OmoGitMasterSettingsSchema.parse({})

describe("omo-senpi git-master attribution component", () => {
  it("#given default settings #when a git-master SKILL.md read result arrives #then the co-author trailer and footer directive are appended", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(pi, defaultSettings())

    // when
    const transform = await dispatchRead(pi, readResultPayload("/home/user/.omo/agent/skills/git-master/SKILL.md"))

    // then
    expect(transform).toBeDefined()
    if (transform === undefined) return
    expect(transform.content).toHaveLength(2)
    const appended = appendedTextOf(transform)
    expect(appended).toContain(CO_AUTHOR_TRAILER)
    expect(appended).toContain("Ultraworked with")
  })

  it("#given both attribution settings disabled #when a git-master SKILL.md read result arrives #then the result is untouched", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(
      pi,
      OmoGitMasterSettingsSchema.parse({ commit_footer: false, include_co_authored_by: false }),
    )

    // when
    const transform = await dispatchRead(pi, readResultPayload("/home/user/.omo/agent/skills/git-master/SKILL.md"))

    // then
    expect(transform).toBeUndefined()
  })

  it("#given a read of an unrelated file #when the result arrives #then the result is untouched", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(pi, defaultSettings())

    // when
    const transform = await dispatchRead(pi, readResultPayload("/home/user/project/src/index.ts"))

    // then
    expect(transform).toBeUndefined()
  })

  it("#given a failed read of the git-master skill #when the result arrives #then the result is untouched", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(pi, defaultSettings())

    // when
    const transform = await dispatchRead(
      pi,
      readResultPayload("/home/user/.omo/agent/skills/git-master/SKILL.md", true),
    )

    // then
    expect(transform).toBeUndefined()
  })

  it("#given a custom footer string #when a git-master SKILL.md read result arrives #then the custom footer replaces the builtin text", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(pi, OmoGitMasterSettingsSchema.parse({ commit_footer: "Shipped with omo" }))

    // when
    const transform = await dispatchRead(pi, readResultPayload("/home/user/.omo/agent/skills/git-master/SKILL.md"))

    // then
    expect(transform).toBeDefined()
    if (transform === undefined) return
    const appended = appendedTextOf(transform)
    expect(appended).toContain("Shipped with omo")
    expect(appended).not.toContain("Ultraworked with")
    expect(appended).toContain(CO_AUTHOR_TRAILER)
  })

  it("#given the footer disabled but the co-author enabled #when a git-master SKILL.md read result arrives #then only the trailer is appended", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(pi, OmoGitMasterSettingsSchema.parse({ commit_footer: false }))

    // when
    const transform = await dispatchRead(pi, readResultPayload("/home/user/.omo/agent/skills/git-master/SKILL.md"))

    // then
    expect(transform).toBeDefined()
    if (transform === undefined) return
    const appended = appendedTextOf(transform)
    expect(appended).toContain(CO_AUTHOR_TRAILER)
    expect(appended).not.toContain("Ultraworked with")
  })

  it("#given a Windows-style skill path #when the read result arrives #then the directive is still appended", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(pi, defaultSettings())

    // when
    const transform = await dispatchRead(
      pi,
      readResultPayload("C:\\Users\\dev\\.omo\\agent\\skills\\git-master\\SKILL.md"),
    )

    // then
    expect(transform).toBeDefined()
    if (transform === undefined) return
    expect(appendedTextOf(transform)).toContain(CO_AUTHOR_TRAILER)
  })
})
