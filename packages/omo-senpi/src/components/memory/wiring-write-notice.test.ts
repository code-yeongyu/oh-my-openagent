// The write-notice gate lives in config, so the registration seam must actually carry it to the
// registered tool's renderer - otherwise the knob is decorative.
import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import { resolveMemoryIdentity } from "@oh-my-opencode/memory-core"

import { ensureIdentityRuntimeDirs } from "./context"
import { createMemoryComponent } from "./index"
import {
  MemoryFakeExtensionAPI,
  componentContext,
  loadedMemoryConfig,
  memorySettings,
} from "./memory.test-support"
import { MEMORY_TOOL_NAME } from "./tools"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

async function registerWith(writeNoticeEnabled: boolean): Promise<{
  readonly renderResult: (...args: readonly unknown[]) => { render(width: number): string[] }
}> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-write-notice-wiring-")))
  roots.push(root)
  const cwd = join(root, "project")
  const env = { OMO_MEMORY_HOME: join(root, "memory") }
  const identity = resolveMemoryIdentity("auto", cwd, env)
  await ensureIdentityRuntimeDirs(identity.paths)
  await mkdir(join(identity.paths.transcripts, "session-write-notice"), { recursive: true })
  const pi = new MemoryFakeExtensionAPI()
  createMemoryComponent({
    env,
    loadConfig: () => loadedMemoryConfig(memorySettings({ write_notice: { enabled: writeNoticeEnabled } })),
    resolveCwd: () => cwd,
  }).register(pi, componentContext())
  const tool = pi.tools.find((registered) => registered["name"] === MEMORY_TOOL_NAME)
  if (tool === undefined) throw new Error("memory tool was not registered")
  const renderResult = tool["renderResult"]
  if (typeof renderResult !== "function") throw new Error("memory tool has no renderResult")
  return { renderResult: renderResult as (...args: readonly unknown[]) => { render(width: number): string[] } }
}

const RESULT = {
  content: [{ type: "text", text: "Memory create committed locally (a1b2c3d)." }],
  details: {
    message: "Memory create committed locally (a1b2c3d).",
    writeNotice: {
      sha: "a1b2c3d4e5f6",
      subject: "Track a fact",
      identity: "project-a1b2c3d4",
      affected: [{ path: "knowledge/fact.md", insertions: 4, deletions: 0 }],
      timeline: { entriesToday: 2 },
    },
  },
}

const THEME = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text }

function lines(renderResult: (...args: readonly unknown[]) => { render(width: number): string[] }): string[] {
  return renderResult(RESULT, { expanded: false, isPartial: false }, THEME, { isError: false }).render(200)
}

describe("memory write notice wiring", () => {
  test("#given the write notice is enabled #when the registered tool renders a committed result #then the notice replaces the local-commit line", async () => {
    // given
    const { renderResult } = await registerWith(true)

    // when
    const rendered = lines(renderResult)

    // then
    expect(rendered.join("\n")).toContain("Memory updated · 2nd entry today")
    expect(rendered.join("\n")).not.toContain("committed locally")
  }, 30_000)

  test("#given the write notice is disabled in config #when the registered tool renders #then the plain message survives", async () => {
    // given
    const { renderResult } = await registerWith(false)

    // when
    const rendered = lines(renderResult)

    // then
    expect(rendered).toEqual(["Memory create committed locally (a1b2c3d)."])
  }, 30_000)
})
