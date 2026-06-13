import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTargetSessionTools } from "./target-session-tools"

let root: string
let agentDir: string
const cwd = "/workspace/project"

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omo-target-sessions-"))
  agentDir = join(root, "agent")
  const sessionDirectory = join(agentDir, "sessions", "project")
  mkdirSync(sessionDirectory, { recursive: true })
  writeFileSync(
    join(sessionDirectory, "session.jsonl"),
    [
      JSON.stringify({ type: "session", id: "session-cert-123", timestamp: "2026-06-12T00:00:00.000Z", cwd }),
      JSON.stringify({ type: "model_change", model: "mimo-v2.5-pro" }),
      JSON.stringify({ type: "thinking_level_change", thinkingLevel: "high" }),
      JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "CERT_SESSION_MARKER" }] } }),
      JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }),
      "",
    ].join("\n"),
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("target session tools", () => {
  test("#given target JSONL session #when list, read, search, and info run #then each exposes the persisted session", async () => {
    const tools = createTargetSessionTools({ host: "pi", cwd, agentDir })
    const request = (input: Record<string, unknown>) => ({
      toolCallId: "call",
      name: "session",
      input,
      session: {} as never,
    })

    const listed = await tools.session_list?.execute(request({ project_path: cwd }))
    const read = await tools.session_read?.execute(request({ session_id: "session-cert" }))
    const searched = await tools.session_search?.execute(request({ query: "CERT_SESSION_MARKER" }))
    const info = await tools.session_info?.execute(request({ session_id: "session-cert-123" }))

    expect(listed?.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("session-cert-123") })
    expect(read?.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("CERT_SESSION_MARKER") })
    expect(searched?.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("CERT_SESSION_MARKER") })
    expect(info?.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("mimo-v2.5-pro") })
  })
})
