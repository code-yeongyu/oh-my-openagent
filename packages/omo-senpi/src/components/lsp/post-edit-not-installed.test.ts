import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createLspComponent } from "./index"

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempDirectories.push(root)
  return root
}

function touch(path: string): string {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, "")
  return path
}

type Decision = "declined" | "allowed" | null

function notInstalledResult(filePath: string, decision: Decision = null) {
  const serverId = filePath.endsWith(".json") ? "biome" : "typescript"
  const text = `LSP server '${serverId}' is NOT INSTALLED.\nACTION REQUIRED — ASK THE USER whether to install this LSP server. [${decision ?? "ask"}]`
  return {
    content: [{ type: "text" as const, text }],
    details: {
      filePath,
      errorKind: "missing_dependency",
      availability: {
        kind: "not_installed",
        serverId,
        command: [serverId],
        extensions: [".ts"],
        installHint: "install it",
        installDecisionTool: false,
        installDecisionsPath: "/unused/lsp-install-decisions.json",
        decision,
      },
    },
  }
}

function writeEvent(path: string) {
  return {
    type: "tool_result",
    toolCallId: `write-${path}`,
    toolName: "write",
    input: { path },
    content: [{ type: "text", text: "Wrote file successfully." }],
    isError: false,
  }
}

function eventContext(sessionId: string, agentDir: string) {
  return { agentDir, sessionManager: { getSessionId: () => sessionId } }
}

function setup(cwd: string, decision: Decision = null) {
  const pi = new FakeExtensionAPI()
  pi.cwd = cwd
  const ctx: ComponentContext = {
    logger: { info() {}, warn() {}, error() {} },
    config: { getFlag: (name) => pi.getFlag(name) },
  }
  createLspComponent({
    callDaemonTool: async (_name, args) => notInstalledResult(String(args["filePath"]), decision),
  }).register(pi, ctx)
  return pi
}

async function appendedTexts(pi: FakeExtensionAPI, path: string, context: unknown): Promise<readonly string[]> {
  const results = await pi.dispatch("tool_result", writeEvent(path), context)
  return results.flatMap((result) => {
    if (typeof result !== "object" || result === null || !("content" in result)) return []
    const content = (result as { readonly content?: readonly { readonly text?: string }[] }).content ?? []
    return content.slice(1).map((block) => block.text ?? "")
  })
}

describe("omo-senpi post-edit not-installed guidance (#9223)", () => {
  it("#given edits to agent config and project files #when the server is missing #then only the project file is nudged, once per server", async () => {
    const root = tempRoot("senpi-9223-")
    const project = join(root, "project")
    touch(join(project, "package.json"))
    const agentDir = join(root, "home", ".omo", "agent")
    const pi = setup(project)
    const context = eventContext("session-a", agentDir)

    const agentConfig = await appendedTexts(pi, touch(join(agentDir, "models.json")), context)
    const firstTs = await appendedTexts(pi, "src/a.ts", context)
    const secondTs = await appendedTexts(pi, "src/b.ts", context)
    const firstJson = await appendedTexts(pi, "tsconfig.json", context)
    const otherSession = await appendedTexts(pi, "src/c.ts", eventContext("session-b", agentDir))

    expect(agentConfig).toEqual([])
    expect(firstTs).toHaveLength(1)
    expect(firstTs[0]).toContain("[ask]")
    expect(secondTs).toEqual([])
    expect(firstJson).toHaveLength(1)
    expect(otherSession).toHaveLength(1)
  })

  it("#given a scratch file outside any project #when the server is missing #then no nudge is appended", async () => {
    const root = tempRoot("senpi-9223-noproject-")
    const pi = setup(root)

    expect(await appendedTexts(pi, touch(join(root, "rules_test.mjs")), eventContext("s", join(root, "agent")))).toEqual(
      [],
    )
  })

  it("#given a recorded declined decision #when edits repeat #then the declined text is appended every time", async () => {
    const root = tempRoot("senpi-9223-declined-")
    touch(join(root, "package.json"))
    const pi = setup(root, "declined")
    const context = eventContext("s", join(root, "agent"))

    expect(await appendedTexts(pi, "a.ts", context)).toHaveLength(1)
    expect(await appendedTexts(pi, "b.ts", context)).toHaveLength(1)
  })
})
