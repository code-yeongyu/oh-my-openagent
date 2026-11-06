import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { createTempDirectories, runScan } from "./test-support"

const temp = createTempDirectories()
afterEach(() => temp.cleanup())

const T0 = "2026-08-27T09:00:00.000Z"

const startupRecordLines = (cwd: string, id: string): Array<string> => [
  JSON.stringify({ type: "session", version: 3, id, timestamp: T0, cwd }),
  JSON.stringify({ type: "model_change", id: "p0000001", parentId: null, timestamp: T0, provider: "openai", modelId: "gpt-6.1-sol" }),
  JSON.stringify({ type: "thinking_level_change", id: "p0000002", parentId: "p0000001", timestamp: T0, thinkingLevel: "high" }),
  JSON.stringify({ type: "custom", customType: "pi-rules.scan", id: "p0000003", parentId: "p0000002", timestamp: T0, data: { cwd, reason: "startup" } }),
  JSON.stringify({ type: "custom_message", customType: "omo-model-profile:unavailable", id: "p0000004", parentId: "p0000003", timestamp: T0, content: "no model", display: true }),
]

const startupOnlySession = (cwd: string, id: string) => `${startupRecordLines(cwd, id).join("\n")}\n`
const startupThenOneMessageSession = (cwd: string, id: string) =>
  `${[...startupRecordLines(cwd, id), JSON.stringify({ type: "message", id: "p0000007", parentId: "p0000004", timestamp: T0, message: { role: "user", content: [{ type: "text", text: "hello" }] } })].join("\n")}\n`

async function scanWithOmoSessions(root: string, sessions: string) {
  return runScan({ claudeHomePath: join(root, "claude"), codexHomePath: join(root, "codex"), omoSessionsRoots: [sessions] })
}

describe("session-history scanProjects omo CLI sessions (parity with desktop AgentSessionScanner.omo.test)", () => {
  it("#given broken history and a deleted project #when scanned #then offers nothing", async () => {
    // given
    const root = await temp.make("omo-project-discovery-")
    const sessions = join(root, "agent", "sessions")
    await mkdir(sessions, { recursive: true })
    await writeFile(join(sessions, "broken.jsonl"), "{broken")
    await writeFile(join(sessions, "deleted.jsonl"), JSON.stringify({ type: "session", version: 3, id: "deleted-project-session", cwd: join(root, "deleted-project") }))

    // when
    const result = await scanWithOmoSessions(root, sessions)

    // then
    expect(result.candidates).toEqual([])
  })

  it("#given a finished CLI conversation #when scanned #then offers its project", async () => {
    // given
    const root = await temp.make("omo-project-discovery-")
    const project = join(root, "existing-project")
    const sessions = join(root, "agent", "sessions")
    const encoded = join(sessions, "--existing-project--")
    await mkdir(project)
    await mkdir(encoded, { recursive: true })
    await writeFile(join(encoded, "finished.jsonl"), [
      JSON.stringify({ type: "session", version: 3, id: "finished-cli-session", cwd: project, timestamp: "2026-01-01T00:00:00.000Z" }),
      JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "Work on this project." }] } }),
    ].join("\n"))

    // when
    const result = await scanWithOmoSessions(root, sessions)

    // then
    expect(result.candidates.map((candidate) => candidate.path)).toContain(project)
    expect(result.candidates.find((candidate) => candidate.path === project)?.sources).toEqual(["omo"])
  })

  it("#given a folder whose only sessions hold startup records #when scanned #then does not offer it", async () => {
    // given
    const root = await temp.make("omo-project-discovery-")
    const serverFolder = join(root, "home")
    const project = join(root, "talked-project")
    const sessions = join(root, "agent", "sessions")
    const probeSessions = join(sessions, "--home--")
    const projectSessions = join(sessions, "--talked-project--")
    await mkdir(serverFolder)
    await mkdir(project)
    await mkdir(probeSessions, { recursive: true })
    await mkdir(projectSessions, { recursive: true })
    for (const index of [1, 2, 3]) {
      await writeFile(join(probeSessions, `probe-${index}.jsonl`), startupOnlySession(serverFolder, `0199d0c0-3333-7000-8000-00000000000${index}`))
    }
    await writeFile(join(projectSessions, "talked.jsonl"), startupThenOneMessageSession(project, "0199d0c0-3333-7000-8000-000000000009"))

    // when
    const result = await scanWithOmoSessions(root, sessions)

    // then
    const offered = result.candidates.map((candidate) => candidate.path)
    expect(offered).toContain(project)
    expect(offered).not.toContain(serverFolder)
  })
})
