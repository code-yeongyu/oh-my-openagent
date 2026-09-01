import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { fakeCommandContext, fakeDeps, invoke, tempIdentity } from "./commands.test-support"
import { registerSearchCommand } from "./search"
import { realpathSync } from "node:fs"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function writeSession(
  sessionsDir: string,
  dirName: string,
  sessionId: string,
  messages: ReadonlyArray<{ id: string; role: string; text: string; timestamp: string }>,
): Promise<string> {
  const dir = join(sessionsDir, dirName)
  await mkdir(dir, { recursive: true })
  const lines = [
    JSON.stringify({ type: "session", id: sessionId, timestamp: messages[0]?.timestamp }),
    ...messages.map((message) =>
      JSON.stringify({
        type: "message",
        id: message.id,
        timestamp: message.timestamp,
        message: { role: message.role, content: [{ type: "text", text: message.text }] },
      }),
    ),
  ]
  const filePath = join(dir, `${sessionId}.jsonl`)
  await writeFile(filePath, `${lines.join("\n")}\n`)
  return filePath
}

async function setup(): Promise<{ sessionsDir: string; pi: MemoryFakeExtensionAPI }> {
  const sessionsDir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-search-sessions-")))
  tempDirs.push(sessionsDir)
  await writeSession(sessionsDir, "sess-a", "sess-a", [
    { id: "msg-1", role: "user", text: "how do I run the linter before committing", timestamp: "2026-08-01T10:00:01.000Z" },
    { id: "msg-2", role: "assistant", text: "run bun run lint first, then commit", timestamp: "2026-08-01T10:00:02.000Z" },
  ])
  await writeSession(sessionsDir, "sess-b", "sess-b", [
    { id: "msg-9", role: "user", text: "tabs versus spaces preference", timestamp: "2026-08-02T09:00:00.000Z" },
  ])
  const hiddenPath = await writeSession(sessionsDir, "sess-hidden", "sess-hidden", [
    { id: "msg-h", role: "user", text: "linter notes from a hidden session", timestamp: "2026-08-03T09:00:00.000Z" },
  ])
  await writeFile(`${hiddenPath}.archived`, "")

  const { root, identity } = await tempIdentity()
  tempDirs.push(root)
  const pi = new MemoryFakeExtensionAPI()
  registerSearchCommand(pi, fakeDeps(identity, { sessionsDir: () => sessionsDir }))
  return { sessionsDir, pi }
}

describe("/search", () => {
  test("#given sessions on disk #when queried #then numbered results carry session id, date, role, snippet, and entry id", async () => {
    // given
    const { pi } = await setup()
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "search", "linter", ctx)

    // then
    expect(text).toContain('1. session sess-a · 2026-08-01T10:00:01.000Z · user')
    expect(text).toContain("**linter**")
    expect(text).toContain("entry msg-1")
    expect(text).not.toContain("sess-hidden")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("info")
  })

  test("#given a hidden session #when queried with --include-hidden #then hidden results appear", async () => {
    // given
    const { pi } = await setup()
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "search", "linter --include-hidden", ctx)

    // then
    expect(text).toContain("sess-hidden")
  })

  test("#given no matching documents #when queried #then a no-results message is returned", async () => {
    // given
    const { pi } = await setup()
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "search", "zzzznotfound", ctx)

    // then
    expect(text).toContain('No matches for "zzzznotfound"')
  })

  test("#given an empty query #when invoked #then a usage error is returned", async () => {
    // given
    const { pi } = await setup()
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "search", "  ", ctx)

    // then
    expect(text).toContain("usage: /search <query>")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given a missing sessions directory #when invoked #then an actionable error is returned", async () => {
    // given
    const pi = new MemoryFakeExtensionAPI()
    registerSearchCommand(pi, fakeDeps(undefined, { sessionsDir: () => "/nonexistent/sessions" }))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "search", "linter", ctx)

    // then
    expect(text).toContain("no senpi sessions directory")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })
})
