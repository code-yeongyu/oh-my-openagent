import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createLspComponent } from "./index"

type DaemonResult = {
  readonly content: readonly { readonly type: "text"; readonly text: string }[]
  readonly details?: unknown
}

const CLEAN: DaemonResult = { content: [{ type: "text", text: "No diagnostics found" }] }

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function notConfigured(filePath: string): DaemonResult {
  const dot = filePath.lastIndexOf(".")
  const extension = dot === -1 ? "" : filePath.slice(dot).toLowerCase()
  return {
    content: [{ type: "text", text: `No LSP server configured for extension: ${extension}` }],
    details: { availability: { kind: "not_configured", extension } },
  }
}

const NOT_INSTALLED_TEXT =
  "LSP server 'typescript' is NOT INSTALLED.\nACTION REQUIRED: ASK THE USER whether to install this LSP server."

function notInstalled(): DaemonResult {
  return {
    content: [{ type: "text", text: NOT_INSTALLED_TEXT }],
    details: {
      availability: {
        kind: "not_installed",
        serverId: "typescript",
        command: ["typescript-language-server"],
        extensions: [".ts"],
        installHint: "install it",
        installDecisionTool: false,
        installDecisionsPath: "/unused/lsp-install-decisions.json",
        decision: null,
      },
    },
  }
}

function harness(respond: (filePath: string) => DaemonResult, cwd?: string) {
  const pi = new FakeExtensionAPI()
  if (cwd !== undefined) pi.cwd = cwd
  const ctx: ComponentContext = {
    logger: { info() {}, warn() {}, error() {} },
    config: { getFlag: (name) => pi.getFlag(name) },
  }
  const checked: string[] = []
  createLspComponent({
    callDaemonTool: async (name, args) => {
      if (name !== "lsp_diagnostics") throw new Error(`unexpected daemon tool ${name}`)
      const filePath = String(args["filePath"])
      checked.push(filePath)
      return respond(filePath)
    },
  }).register(pi, ctx)
  return { pi, checked }
}

function session(sessionId: string, agentDir?: string) {
  return { ...(agentDir === undefined ? {} : { agentDir }), sessionManager: { getSessionId: () => sessionId } }
}

function write(path: string) {
  return {
    type: "tool_result",
    toolCallId: `write-${path}`,
    toolName: "write",
    input: { path },
    content: [{ type: "text", text: "Wrote file successfully." }],
    isError: false,
  }
}

async function appended(pi: FakeExtensionAPI, path: string, context: unknown): Promise<readonly string[]> {
  const results = await pi.dispatch("tool_result", write(path), context)
  return results.flatMap((result) => {
    if (typeof result !== "object" || result === null || !("content" in result)) return []
    const content = (result as { readonly content?: readonly { readonly text?: string }[] }).content ?? []
    return content.slice(1).map((block) => block.text ?? "")
  })
}

describe("omo-senpi lsp post-edit dedup and reset (characterization X8b)", () => {
  it("#given an extension reported not configured #when more files are edited in the session #then that extension is skipped, case-insensitively, and others are still checked", async () => {
    const { pi, checked } = harness((filePath) => (filePath.endsWith(".ts") ? CLEAN : notConfigured(filePath)))
    const ctx = session("s1")

    await pi.dispatch("tool_result", write("a.foo"), ctx)
    await pi.dispatch("tool_result", write("b.foo"), ctx)
    await pi.dispatch("tool_result", write("C.FOO"), ctx)
    await pi.dispatch("tool_result", write("d.bar"), ctx)
    await pi.dispatch("tool_result", write("e.bar"), ctx)
    await pi.dispatch("tool_result", write("f.ts"), ctx)

    expect(checked).toEqual(["a.foo", "d.bar", "f.ts"])
  })

  it("#given a skipped extension #when turns start and end #then the skip is session-scoped and survives them", async () => {
    const { pi, checked } = harness(notConfigured)
    const ctx = session("s1")

    await pi.dispatch("tool_result", write("a.foo"), ctx)
    for (let turn = 0; turn < 3; turn += 1) {
      await pi.dispatch("turn_start", { type: "turn_start", turnIndex: turn }, ctx)
      await pi.dispatch("tool_result", write(`turn-${turn}.foo`), ctx)
      await pi.dispatch("turn_end", { type: "turn_end", turnIndex: turn }, ctx)
      await pi.dispatch("agent_end", { type: "agent_end", messages: [] }, ctx)
    }

    expect(checked).toEqual(["a.foo"])
  })

  it("#given a session that already has state #when session_start fires again #then its skip set is kept", async () => {
    const { pi, checked } = harness(notConfigured)
    const ctx = session("s1")

    await pi.dispatch("session_start", { type: "session_start" }, ctx)
    await pi.dispatch("tool_result", write("a.foo"), ctx)
    await pi.dispatch("session_start", { type: "session_start" }, ctx)
    await pi.dispatch("tool_result", write("b.foo"), ctx)

    expect(checked).toEqual(["a.foo"])
  })

  it("#given two sessions that both skip an extension #when one session compacts #then only that session checks it again", async () => {
    const { pi, checked } = harness(notConfigured)
    const parent = session("parent")
    const child = session("child")

    await pi.dispatch("tool_result", write("parent-1.foo"), parent)
    await pi.dispatch("tool_result", write("child-1.foo"), child)
    await pi.dispatch("session_compact", { type: "session_compact" }, parent)
    await pi.dispatch("tool_result", write("parent-2.foo"), parent)
    await pi.dispatch("tool_result", write("child-2.foo"), child)
    await pi.dispatch("tool_result", write("parent-3.foo"), parent)

    expect(checked).toEqual(["parent-1.foo", "child-1.foo", "parent-2.foo"])
  })

  it("#given a session that skips an extension #when session_shutdown fires #then its state is dropped and the next edit is checked again", async () => {
    const { pi, checked } = harness(notConfigured)
    const ctx = session("s1")
    const other = session("s2")

    await pi.dispatch("tool_result", write("a.foo"), ctx)
    await pi.dispatch("tool_result", write("x.foo"), other)
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, ctx)
    await pi.dispatch("tool_result", write("b.foo"), ctx)
    await pi.dispatch("tool_result", write("c.foo"), ctx)
    await pi.dispatch("tool_result", write("y.foo"), other)

    expect(checked).toEqual(["a.foo", "x.foo", "b.foo"])
  })

  it("#given a context without a session id #when not-configured files are edited #then nothing is remembered between tool results", async () => {
    const { pi, checked } = harness(notConfigured)

    await pi.dispatch("tool_result", write("a.foo"), {})
    await pi.dispatch("tool_result", write("b.foo"), {})
    await pi.dispatch("tool_result", write("c.foo"), undefined)

    expect(checked).toEqual(["a.foo", "b.foo", "c.foo"])
  })

  it("#given clean and error results #when the same file is edited again #then it is checked every time, and duplicate paths in one result are checked once", async () => {
    const { pi, checked } = harness((filePath) =>
      filePath === "broken.ts" ? { content: [{ type: "text", text: "error[typescript] (2322) at 1:1: broken" }] } : CLEAN,
    )
    const ctx = session("s1")

    await pi.dispatch("tool_result", write("clean.ts"), ctx)
    await pi.dispatch("tool_result", write("clean.ts"), ctx)
    expect(await appended(pi, "broken.ts", ctx)).toHaveLength(1)
    expect(await appended(pi, "broken.ts", ctx)).toHaveLength(1)
    await pi.dispatch(
      "tool_result",
      {
        type: "tool_result",
        toolCallId: "edit-1",
        toolName: "edit",
        input: { filePaths: ["clean.ts", "other.ts", "clean.ts"] },
        content: [{ type: "text", text: "Edited files." }],
        isError: false,
      },
      ctx,
    )

    expect(checked).toEqual(["clean.ts", "clean.ts", "broken.ts", "broken.ts", "clean.ts", "other.ts"])
  })

  it("#given an undecided missing server in a project #when files are edited, compacted and shut down #then the nudge appears once per server per session state", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-x8b-"))
    tempDirectories.push(root)
    const project = join(root, "project")
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, "package.json"), "{}")
    const agentDir = join(root, "agent")
    const { pi, checked } = harness(notInstalled, project)
    const ctx = session("s1", agentDir)

    const first = await appended(pi, "src/a.ts", ctx)
    const repeat = await appended(pi, "src/b.ts", ctx)
    await pi.dispatch("turn_start", { type: "turn_start", turnIndex: 1 }, ctx)
    const afterTurn = await appended(pi, "src/c.ts", ctx)
    await pi.dispatch("session_compact", { type: "session_compact" }, ctx)
    const afterCompact = await appended(pi, "src/d.ts", ctx)
    const afterCompactRepeat = await appended(pi, "src/e.ts", ctx)
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, ctx)
    const afterShutdown = await appended(pi, "src/f.ts", ctx)

    const nudge = (path: string) => [`\n\nLSP errors detected in ${path}, please fix:\n${NOT_INSTALLED_TEXT}`]
    expect(first).toEqual(nudge("src/a.ts"))
    expect(repeat).toEqual([])
    expect(afterTurn).toEqual([])
    expect(afterCompact).toEqual(nudge("src/d.ts"))
    expect(afterCompactRepeat).toEqual([])
    expect(afterShutdown).toEqual(nudge("src/f.ts"))
    expect(checked).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts"])
  })
})
