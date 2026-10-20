import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { MAX_SESSION_DIGEST_BYTES } from "./constants"
import { createSessionDigestStore } from "./digest-store"
import { scanSessionHistory } from "./scan-session-history"
import { collect, createTempDirectories, encodeRecord, writeTranscript } from "./test-support"

const temp = createTempDirectories()
afterEach(() => temp.cleanup())

const nowMs = Date.parse("2026-08-24T12:00:00.000Z")
const byteLength = (text: string) => new TextEncoder().encode(text).byteLength

async function scanDigests(write: (homes: { claude: string; codex: string; workspace: string }) => Promise<void>) {
  const claude = await temp.make("digest-claude-")
  const codex = await temp.make("digest-codex-")
  const workspace = await temp.make("digest-workspace-")
  const stateDir = await temp.make("digest-state-")
  await write({ claude, codex, workspace })
  const digestStore = createSessionDigestStore({ stateDir })
  await collect(scanSessionHistory({ scanId: "scan-digest", homes: [{ source: "claudeAgent", homePath: claude }, { source: "codex", homePath: codex }], omoSessionsRoots: [], now: () => nowMs, digestStore }))
  return { digests: await digestStore.list("scan-digest"), workspace }
}

describe("session-history digests", () => {
  it("#given a Claude session with edits #when scanned #then digests the request, tools, files and outcome", async () => {
    // given / when
    const { digests, workspace } = await scanDigests(async ({ claude, workspace }) => {
      await writeTranscript({ filePath: join(claude, "projects", "-p", "claude-digest.jsonl"), mtimeMs: nowMs, contents: [
        encodeRecord({ type: "user", cwd: workspace, sessionId: "claude-digest", timestamp: "2026-08-24T10:00:00.000Z", message: { role: "user", content: "Add a login page" } }),
        encodeRecord({ type: "assistant", sessionId: "claude-digest", message: { role: "assistant", model: "claude-sonnet-5", content: [{ type: "tool_use", name: "Read", input: { file_path: join(workspace, "src", "app.ts") } }] } }),
        encodeRecord({ type: "assistant", sessionId: "claude-digest", message: { role: "assistant", content: [{ type: "tool_use", name: "Write", input: { file_path: join(workspace, "src", "login.tsx") } }] } }),
        encodeRecord({ type: "assistant", sessionId: "claude-digest", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: join(workspace, "src", "app.ts") } }, { type: "tool_use", name: "Edit", input: { file_path: join(workspace, "src", "app.ts") } }] } }),
        encodeRecord({ type: "assistant", sessionId: "claude-digest", timestamp: "2026-08-24T10:05:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "Added the login page and wired the route." }] } }),
      ].join("\n") })
    })

    // then
    expect(digests).toHaveLength(1)
    expect(digests[0]).toMatchObject({
      sessionKey: "claudeAgent:claude-digest",
      source: "claudeAgent",
      cwd: workspace,
      firstRequest: "Add a login page",
      toolsUsed: [{ name: "Edit", count: 2 }, { name: "Read", count: 1 }, { name: "Write", count: 1 }],
      filesChanged: [join(workspace, "src", "login.tsx"), join(workspace, "src", "app.ts")],
      outcome: "Added the login page and wired the route.",
    })
  })

  it("#given a Codex session with apply_patch #when scanned #then reads changed files from the patch", async () => {
    // given / when
    const { digests } = await scanDigests(async ({ codex, workspace }) => {
      const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-a\n+b\n*** Add File: src/b.ts\n+x\n*** Delete File: src/c.ts\n*** End Patch"
      await writeTranscript({ filePath: join(codex, "sessions", "2026", "08", "24", "rollout-digest.jsonl"), mtimeMs: nowMs, contents: [
        encodeRecord({ type: "session_meta", payload: { id: "codex-digest", cwd: workspace } }),
        encodeRecord({ type: "event_msg", payload: { type: "user_message", message: "Refactor the parser" } }),
        encodeRecord({ type: "response_item", payload: { type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["rg", "parse"] }) } }),
        encodeRecord({ type: "response_item", payload: { type: "custom_tool_call", name: "apply_patch", input: patch } }),
        encodeRecord({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Parser refactored." }] } }),
      ].join("\n") })
    })

    // then
    expect(digests[0]).toMatchObject({
      sessionKey: "codex:codex-digest",
      firstRequest: "Refactor the parser",
      toolsUsed: [{ name: "apply_patch", count: 1 }, { name: "shell", count: 1 }],
      filesChanged: ["src/a.ts", "src/b.ts", "src/c.ts"],
      outcome: "Parser refactored.",
    })
  })

  it("#given a session with huge text and hundreds of files #when scanned #then the digest stays within 4 KB", async () => {
    // given / when
    const { digests } = await scanDigests(async ({ claude, workspace }) => {
      const edits = Array.from({ length: 300 }, (_, index) => encodeRecord({ type: "assistant", sessionId: "huge", message: { role: "assistant", content: [{ type: "tool_use", name: `Tool${index % 40}`, input: { file_path: join(workspace, `file-${index}.ts`) } }] } }))
      await writeTranscript({ filePath: join(claude, "projects", "-p", "huge.jsonl"), mtimeMs: nowMs, contents: [
        encodeRecord({ type: "user", cwd: workspace, sessionId: "huge", message: { role: "user", content: "R".repeat(50_000) } }),
        ...edits,
        encodeRecord({ type: "assistant", sessionId: "huge", message: { role: "assistant", content: [{ type: "text", text: "O".repeat(50_000) }] } }),
      ].join("\n") })
    })

    // then
    const serialized = JSON.stringify(digests[0])
    expect(byteLength(serialized)).toBeLessThanOrEqual(MAX_SESSION_DIGEST_BYTES)
    expect(byteLength(serialized)).toBeGreaterThan(3 * 1024)
    expect(digests[0]?.truncated).toBe(true)
    expect(digests[0]?.firstRequest.startsWith("RRRR")).toBe(true)
  })
})
