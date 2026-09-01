// The MCP surface consumes each commit receipt EXACTLY ONCE and fans that single read out to
// both visible notices (soul-updated, write-updated). A second read could never see the receipt
// (consumeToolReceipt read-and-deletes), so a duplicated read silently drops a notice; the
// single-consumption test pins that invariant with a counting wrapper around the REAL consumer.
import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { access, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmEfaultTolerant } from "./teardown.test-support"

import type { ThemeColor } from "@code-yeongyu/senpi"
import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import {
  MEMORY_WRITE_UPDATED_ENTRY_TYPE,
  createMemoryNoticeWiring,
  renderMemoryWriteUpdatedEntry,
} from "./memory-notice-wiring"
import { MemoryFakeExtensionAPI } from "./memory.test-support"
import { SOUL_UPDATED_ENTRY_TYPE } from "./soul-notice"
import { consumeToolReceipt, toolReceiptPath, writeToolReceipt } from "./tool-receipts"
import type { MemoryWriteNotice } from "./tools"

const IDENTITY = "memory-notice-agent"
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function fixture(): Promise<{ context: MemoryIdentityContext }> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-notice-")))
  roots.push(root)
  const identityPaths = buildIdentityPaths(root, IDENTITY)
  const context = createMemoryIdentityContext({
    identity: IDENTITY,
    identityPaths,
    binding: createMemoryBinding({ identity: IDENTITY, repoPath: identityPaths.repo, boundAt: 1 }),
  })
  return { context }
}

function eventContext(sessionId: string): unknown {
  return { sessionManager: { getSessionId: () => sessionId } }
}

const SOUL_COMMIT = {
  sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  subject: "rewrite my persona",
  affectedPaths: ["system/persona.md"],
}
const FACT_COMMIT = {
  sha: "b2c3d4e5f60718293a4b5c6d7e8f901234567890",
  subject: "record the deploy runbook",
  affectedPaths: ["knowledge/deploy.md"],
}

function writeNoticeFor(commit: { sha: string; subject: string }): MemoryWriteNotice {
  return {
    sha: commit.sha,
    subject: commit.subject,
    identity: IDENTITY,
    affected: [{ path: "knowledge/deploy.md", insertions: 47, deletions: 0 }],
    size: { systemBytes: 2048, totalBytes: 33_792, fileCount: 12 },
    timeline: { entriesToday: 4 },
  }
}

function wiringFor(
  context: MemoryIdentityContext,
  overrides: Partial<Parameters<typeof createMemoryNoticeWiring>[0]> = {},
): ReturnType<typeof createMemoryNoticeWiring> {
  return createMemoryNoticeWiring({
    resolveContext: () => context,
    resolveEditNotice: () => true,
    resolveWriteNotice: () => true,
    gatherWriteNotice: async (_context, commit) => writeNoticeFor(commit),
    ...overrides,
  })
}

async function dispatchMcpResult(pi: MemoryFakeExtensionAPI, toolCallId: string): Promise<void> {
  await pi.dispatch("tool_result", {
    type: "tool_result",
    toolName: "mcp_omo-memory_memory",
    toolCallId,
    input: {},
    content: [],
    isError: false,
  }, eventContext("session-1"))
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe("createMemoryNoticeWiring shared receipt consumption", () => {
  test("#given a soul commit receipt #when tool_result fires #then the receipt is read exactly once and both notices come from that read", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    let reads = 0
    const wiring = wiringFor(context, {
      consumeReceipt: async (receiptsDir, toolCallId) => {
        reads += 1
        return consumeToolReceipt(receiptsDir, toolCallId)
      },
    })
    wiring.register(pi)
    await writeToolReceipt(context.identityPaths.toolReceipts, { version: 1, toolCallId: "call-1", ...SOUL_COMMIT })

    // when
    await dispatchMcpResult(pi, "call-1")

    // then
    expect(reads).toBe(1)
    expect(pi.entries.map((entry) => entry.customType)).toEqual([
      SOUL_UPDATED_ENTRY_TYPE,
      MEMORY_WRITE_UPDATED_ENTRY_TYPE,
    ])
    expect(await exists(toolReceiptPath(context.identityPaths.toolReceipts, "call-1"))).toBe(false)
  })

  test("#given a soul commit with the write notice disabled #when tool_result fires #then only the soul notice is emitted", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    const wiring = wiringFor(context, { resolveWriteNotice: () => false })
    wiring.register(pi)
    await writeToolReceipt(context.identityPaths.toolReceipts, { version: 1, toolCallId: "call-2", ...SOUL_COMMIT })

    // when
    await dispatchMcpResult(pi, "call-2")

    // then
    expect(pi.entries).toEqual([{ customType: SOUL_UPDATED_ENTRY_TYPE, data: SOUL_COMMIT }])
  })

  test("#given a non-soul commit #when tool_result fires #then only the write notice is emitted", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor(context).register(pi)
    await writeToolReceipt(context.identityPaths.toolReceipts, { version: 1, toolCallId: "call-3", ...FACT_COMMIT })

    // when
    await dispatchMcpResult(pi, "call-3")

    // then
    expect(pi.entries).toEqual([
      { customType: MEMORY_WRITE_UPDATED_ENTRY_TYPE, data: writeNoticeFor(FACT_COMMIT) },
    ])
  })

  test("#given the soul notice is disabled and the commit is soul-only #when tool_result fires #then only the write notice is emitted", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor(context, { resolveEditNotice: () => false }).register(pi)
    await writeToolReceipt(context.identityPaths.toolReceipts, { version: 1, toolCallId: "call-4", ...SOUL_COMMIT })

    // when
    await dispatchMcpResult(pi, "call-4")

    // then
    expect(pi.entries.map((entry) => entry.customType)).toEqual([MEMORY_WRITE_UPDATED_ENTRY_TYPE])
  })

  test("#given both notices are disabled #when tool_result fires #then the receipt is still consumed and nothing is emitted", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor(context, { resolveEditNotice: () => false, resolveWriteNotice: () => false }).register(pi)
    await writeToolReceipt(context.identityPaths.toolReceipts, { version: 1, toolCallId: "call-5", ...SOUL_COMMIT })

    // when
    await dispatchMcpResult(pi, "call-5")

    // then
    expect(pi.entries).toHaveLength(0)
    expect(await exists(toolReceiptPath(context.identityPaths.toolReceipts, "call-5"))).toBe(false)
  })

  test("#given a degraded gather #when tool_result fires #then the soul notice still lands and no write entry is appended", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor(context, { gatherWriteNotice: async () => undefined }).register(pi)
    await writeToolReceipt(context.identityPaths.toolReceipts, { version: 1, toolCallId: "call-6", ...SOUL_COMMIT })

    // when
    await dispatchMcpResult(pi, "call-6")

    // then
    expect(pi.entries.map((entry) => entry.customType)).toEqual([SOUL_UPDATED_ENTRY_TYPE])
  })

  test("#given registration #when the component registers #then both entry renderers are registered", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()

    // when
    wiringFor(context).register(pi)

    // then
    expect(pi.entryRenderers.map((registration) => registration.customType)).toEqual([
      SOUL_UPDATED_ENTRY_TYPE,
      MEMORY_WRITE_UPDATED_ENTRY_TYPE,
    ])
  })
})

describe("createMemoryNoticeWiring receipt edge cases", () => {
  test("#given a receipt whose embedded toolCallId does not match the event #when tool_result fires #then nothing is emitted and the receipt is consumed", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor(context).register(pi)
    const forged = toolReceiptPath(context.identityPaths.toolReceipts, "call-forged")
    await writeToolReceipt(context.identityPaths.toolReceipts, { version: 1, toolCallId: "call-other", ...SOUL_COMMIT })
    await writeFile(forged, `${JSON.stringify({ version: 1, toolCallId: "call-other", ...SOUL_COMMIT })}\n`, "utf8")

    // when
    await dispatchMcpResult(pi, "call-forged")

    // then
    expect(pi.entries).toHaveLength(0)
    expect(await exists(forged)).toBe(false)
  })

  test("#given no receipt on disk #when tool_result fires #then nothing is appended and nothing throws", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor(context).register(pi)

    // when
    await dispatchMcpResult(pi, "call-absent")

    // then
    expect(pi.entries).toHaveLength(0)
  })

  test("#given a non-memory tool result #when tool_result fires #then receipts are left untouched", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor(context).register(pi)
    await writeToolReceipt(context.identityPaths.toolReceipts, { version: 1, toolCallId: "call-9", ...SOUL_COMMIT })

    // when
    await pi.dispatch("tool_result", {
      type: "tool_result",
      toolName: "bash",
      toolCallId: "call-9",
      input: {},
      content: [],
      isError: false,
    }, eventContext("session-1"))

    // then
    expect(pi.entries).toHaveLength(0)
    expect(await exists(toolReceiptPath(context.identityPaths.toolReceipts, "call-9"))).toBe(true)
  })
})

describe("createMemoryNoticeWiring direct surface", () => {
  test("#given a direct-surface commit #when onCommit fires #then only the soul notice is emitted and no write entry duplicates the tool row", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    const wiring = wiringFor(context)
    wiring.register(pi)

    // when
    wiring.onCommit(context, SOUL_COMMIT)

    // then
    expect(pi.entries).toEqual([{ customType: SOUL_UPDATED_ENTRY_TYPE, data: SOUL_COMMIT }])
  })

  test("#given a direct-surface non-soul commit #when onCommit fires #then no entry is appended", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    const wiring = wiringFor(context)
    wiring.register(pi)

    // when
    wiring.onCommit(context, FACT_COMMIT)

    // then
    expect(pi.entries).toHaveLength(0)
  })

  test("#given edit_notice disabled #when a direct-surface soul commit arrives #then no visible entry is appended", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    const wiring = wiringFor(context, { resolveEditNotice: () => false })
    wiring.register(pi)

    // when
    wiring.onCommit(context, SOUL_COMMIT)

    // then
    expect(pi.entries).toHaveLength(0)
  })

  test("#given a direct-surface tool_result #when it fires with no receipt on disk #then neither notice is emitted", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor(context).register(pi)

    // when: the direct tool surface writes no receipt, so the shared consumer finds nothing
    await pi.dispatch("tool_result", {
      type: "tool_result",
      toolName: "memory",
      toolCallId: "call-direct",
      input: {},
      content: [],
      isError: false,
    }, eventContext("session-1"))

    // then
    expect(pi.entries).toHaveLength(0)
  })
})

const BOLD = "\u001b[1m"
const BOLD_OFF = "\u001b[22m"
function bold(text: string): string {
  return `${BOLD}${text}${BOLD_OFF}`
}

const PLAIN_THEME = {
  fg: (_color: ThemeColor, text: string) => text,
  bg: (_color: "customMessageBg", text: string) => text,
}

function recordingTheme(): {
  readonly theme: { fg: (color: ThemeColor, text: string) => string; bg: (color: "customMessageBg", text: string) => string }
  readonly colors: ThemeColor[]
} {
  const colors: ThemeColor[] = []
  return {
    theme: {
      fg: (color: ThemeColor, text: string) => {
        colors.push(color)
        return text
      },
      bg: (_color: "customMessageBg", text: string) => text,
    },
    colors,
  }
}

function renderWrite(
  data: MemoryWriteNotice | undefined,
  options: { readonly expanded?: boolean; readonly theme?: unknown } = {},
): string[] {
  const component = renderMemoryWriteUpdatedEntry(
    { data } as never,
    { expanded: options.expanded ?? false },
    (options.theme ?? PLAIN_THEME) as never,
  )
  expect(component).toBeDefined()
  return component!.render(200).slice(1, -1).map((line) => line.slice(1).trimEnd())
}

const RENDER_NOTICE: MemoryWriteNotice = {
  sha: "a1b2c3d4e5f6a7b8",
  subject: "Track the deploy runbook",
  identity: "project-a1b2c3d4",
  affected: [{ path: "knowledge/deploy.md", insertions: 47, deletions: 0 }],
  size: { systemBytes: 2048, totalBytes: 33_792, fileCount: 12 },
  // Relative to the wall clock the renderer reads: the entry renders when the row is drawn, so
  // the age fragment is computed against "now" rather than a frozen snapshot timestamp.
  timeline: {
    entriesToday: 4,
    previousEntryAtISO: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
}

describe("renderMemoryWriteUpdatedEntry house notice contract", () => {
  test("#given a gathered write notice #when it renders collapsed #then it matches the direct-surface tool row", () => {
    // given
    const recorder = recordingTheme()

    // when
    const lines = renderWrite(RENDER_NOTICE, { theme: recorder.theme })

    // then
    expect(lines).toEqual([
      bold("● Memory updated · 4th entry today"),
      "Added 47 lines to knowledge/deploy.md.",
      "system 2.0K injected · 33K total · 12 files",
      "last entry 5m ago",
    ])
    expect(recorder.colors).toEqual(["accent", "dim", "dim", "dim"])
  })

  test("#when it renders expanded #then the detail row carries sha7, identity and subject", () => {
    // when
    const lines = renderWrite(RENDER_NOTICE, { expanded: true })

    // then
    expect(lines.at(-1)).toBe("a1b2c3d · project-a1b2c3d4 · Track the deploy runbook")
  })

  test("#when rendered with a background theme #then every padded line carries customMessageBg", () => {
    const component = renderMemoryWriteUpdatedEntry({ data: RENDER_NOTICE } as never, { expanded: false }, {
      fg: (_color: ThemeColor, text: string) => text,
      bg: (_color: "customMessageBg", text: string) => `<notice-bg>${text}</notice-bg>`,
    } as never)
    for (const line of component!.render(200)) expect(line).toMatch(/^<notice-bg>.*<\/notice-bg>$/u)
  })

  test("#given no record #when it renders #then it returns undefined", () => {
    expect(
      renderMemoryWriteUpdatedEntry({} as never, { expanded: false }, PLAIN_THEME as never),
    ).toBeUndefined()
  })
})
