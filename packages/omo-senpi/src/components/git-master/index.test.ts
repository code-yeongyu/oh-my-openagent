/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { OmoGitMasterSettingsSchema, type OmoGitMasterSettings } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createGitMasterAttributionComponent } from "./index"

const CO_AUTHOR_TRAILER_PATTERN = /Co-authored-by:/i

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
const footerOptIn = (): OmoGitMasterSettings => OmoGitMasterSettingsSchema.parse({ commit_footer: true })

describe("omo-senpi git-master attribution component", () => {
  it("#given default settings #when a git-master SKILL.md read result arrives #then the env-prefix section rides the skill content and no footer is appended", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(pi, defaultSettings())

    // when
    const transform = await dispatchRead(pi, readResultPayload("/home/user/.omo/agent/skills/git-master/SKILL.md"))

    // then
    expect(transform).toBeDefined()
    if (transform === undefined) return
    expect(transform.content).toHaveLength(1)
    const text = transform.content[0]?.text ?? ""
    expect(text).toContain("GIT COMMAND PREFIX (MANDATORY)")
    expect(text).toContain("GIT_MASTER=1 git status")
    expect(text).toContain("NO EXCEPTIONS")
    expect(text).not.toContain("Ultraworked with")
    expect(text).not.toMatch(CO_AUTHOR_TRAILER_PATTERN)
  })

  it("#given the footer opted in #when a git-master SKILL.md read result arrives #then only the footer directive is appended", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(pi, footerOptIn())

    // when
    const transform = await dispatchRead(pi, readResultPayload("/home/user/.omo/agent/skills/git-master/SKILL.md"))

    // then
    expect(transform).toBeDefined()
    if (transform === undefined) return
    expect(transform.content).toHaveLength(2)
    const appended = appendedTextOf(transform)
    expect(appended).toContain("Ultraworked with")
    expect(appended).not.toMatch(CO_AUTHOR_TRAILER_PATTERN)
    expect(appended).not.toContain("sisyphus-dev-ai")
    expect(appended).not.toContain("users.noreply.github.com")
  })

  it("#given both attribution settings disabled and the env prefix disabled #when a git-master SKILL.md read result arrives #then the result is untouched", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(
      pi,
      OmoGitMasterSettingsSchema.parse({ commit_footer: false, include_co_authored_by: false, git_env_prefix: "" }),
    )

    // when
    const transform = await dispatchRead(pi, readResultPayload("/home/user/.omo/agent/skills/git-master/SKILL.md"))

    // then
    expect(transform).toBeUndefined()
  })

  it("#given default settings #when the skill body carries bash git commands #then every git command in the bash blocks is prefixed", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(pi, defaultSettings())
    const payload = readResultPayload("/home/user/.omo/agent/skills/git-master/SKILL.md")
    payload.content = [
      {
        type: "text",
        text: "# Git Master\n\n```bash\ngit add -A .\ngit commit -m \"x\"\necho done\n```",
      },
    ]

    // when
    const transform = await dispatchRead(pi, payload)

    // then
    expect(transform).toBeDefined()
    if (transform === undefined) return
    const text = transform.content[0]?.text ?? ""
    expect(text).toContain("GIT_MASTER=1 git add -A .")
    expect(text).toContain("GIT_MASTER=1 git commit -m \"x\"")
    expect(text).toContain("\necho done")
  })

  it("#given senpi started from a non-bash login shell #when a git-master SKILL.md read result arrives #then the prefix uses the bash form senpi's bash tool runs", async () => {
    // given
    const saved = { SHELL: process.env["SHELL"], PSModulePath: process.env["PSModulePath"] }
    try {
      for (const loginShell of ["/bin/tcsh", "/usr/local/bin/fish", "/bin/zsh"]) {
        process.env["SHELL"] = loginShell
        process.env["PSModulePath"] = "C:\\Program Files\\PowerShell\\Modules"
        const pi = new FakeExtensionAPI()
        await registerWithSettings(pi, defaultSettings())
        const payload = readResultPayload("/home/user/.omo/agent/skills/git-master/SKILL.md")
        payload.content = [{ type: "text", text: "# Git Master\n\n```bash\ngit status\n```" }]

        // when
        const transform = await dispatchRead(pi, payload)

        // then
        const text = transform?.content[0]?.text ?? ""
        expect(text).toContain("\nGIT_MASTER=1 git status\n```")
        expect(text).not.toContain("setenv")
        expect(text).not.toContain("$env:")
      }
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it("#given a skill file with YAML frontmatter #when a git-master SKILL.md read result arrives #then the prefix section follows the frontmatter", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(pi, defaultSettings())
    const payload = readResultPayload("/home/user/.omo/agent/skills/git-master/SKILL.md")
    payload.content = [{ type: "text", text: "---\nname: git-master\ndescription: x\n---\n# Git Master\n" }]

    // when
    const transform = await dispatchRead(pi, payload)

    // then
    const text = transform?.content[0]?.text ?? ""
    expect(text.startsWith("---\nname: git-master\ndescription: x\n---\n")).toBe(true)
    expect(text.indexOf("<git_env_prefix>")).toBeGreaterThan(text.indexOf("description: x"))
  })

  it("#given a read of an unrelated file #when the result arrives #then the result is untouched", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(pi, footerOptIn())

    // when
    const transform = await dispatchRead(pi, readResultPayload("/home/user/project/src/index.ts"))

    // then
    expect(transform).toBeUndefined()
  })

  it("#given a failed read of the git-master skill #when the result arrives #then the result is untouched", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(pi, footerOptIn())

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
    expect(appended).not.toMatch(CO_AUTHOR_TRAILER_PATTERN)
  })

  it("#given the deprecated co-author flag enabled without the footer or env prefix #when a git-master SKILL.md read result arrives #then the result is untouched", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(
      pi,
      OmoGitMasterSettingsSchema.parse({ commit_footer: false, include_co_authored_by: true, git_env_prefix: "" }),
    )

    // when
    const transform = await dispatchRead(pi, readResultPayload("/home/user/.omo/agent/skills/git-master/SKILL.md"))

    // then
    expect(transform).toBeUndefined()
  })

  it("#given a Windows-style skill path with the footer opted in #when the read result arrives #then the directive is still appended", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerWithSettings(pi, footerOptIn())

    // when
    const transform = await dispatchRead(
      pi,
      readResultPayload("C:\\Users\\dev\\.omo\\agent\\skills\\git-master\\SKILL.md"),
    )

    // then
    expect(transform).toBeDefined()
    if (transform === undefined) return
    expect(appendedTextOf(transform)).toContain("Ultraworked with")
  })
})
