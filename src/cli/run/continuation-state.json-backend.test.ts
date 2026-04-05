declare const require: (name: string) => any
const { afterEach, describe, expect, mock, test, afterAll } = require("bun:test")
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDirs: string[] = []

const TEST_STORAGE_ROOT = join(tmpdir(), `omo-run-json-storage-${Date.now()}`)
const TEST_MESSAGE_STORAGE = join(TEST_STORAGE_ROOT, "message")

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
}))

mock.module("../../shared/opencode-message-dir", () => ({
  getMessageDir: (sessionID: string) => {
    const directPath = join(TEST_MESSAGE_STORAGE, sessionID)
    return require("node:fs").existsSync(directPath) ? directPath : null
  },
}))

afterAll(() => { mock.restore() })

afterEach(() => {
  while (testDirs.length > 0) {
    const dir = testDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-run-json-backend-"))
  testDirs.push(directory)
  return directory
}

function writeJsonMessage(sessionID: string, fileName: string, agent: string): void {
  const messageDir = join(TEST_MESSAGE_STORAGE, sessionID)
  mkdirSync(messageDir, { recursive: true })
  writeFileSync(
    join(messageDir, fileName),
      JSON.stringify({
        agent,
        model: { providerID: "openai", modelID: "gpt-5.4" },
        time: { created: fileName.includes("002") ? 200 : 100 },
      }),
      "utf-8",
    )
}

describe("getContinuationState JSON backend descendant coverage", () => {
  test("returns active boulder for explicitly tracked appended descendant on JSON message storage backend", async () => {
    // given
    const directory = createTempDir()
    const plansDir = join(directory, ".sisyphus", "plans")
    mkdirSync(plansDir, { recursive: true })
    const planPath = join(plansDir, "json-descendant-plan.md")
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    mkdirSync(join(directory, ".sisyphus"), { recursive: true })
    writeFileSync(join(directory, ".sisyphus", "boulder.json"), JSON.stringify({
      active_plan: planPath,
      started_at: new Date().toISOString(),
      session_ids: ["ses_root_session", "ses_child_session"],
      session_origins: {
        "ses_root_session": "direct",
        "ses_child_session": "appended",
      },
      plan_name: "json-descendant-plan",
      agent: "atlas",
    }), "utf-8")
    writeJsonMessage("ses_child_session", "msg_001.json", "atlas")
    writeJsonMessage("ses_child_session", "msg_002.json", "compaction")

    const { getContinuationState } = await import("./continuation-state")

    // when
    const state = await getContinuationState(directory, "ses_child_session", {
      session: {
        get: async ({ path }: { path: { id: string } }) => ({
          data: {
            id: path.id,
            parentID: path.id === "ses_child_session" ? "ses_root_session" : undefined,
          },
        }),
      },
    } as never)

    // then
    expect(state.hasActiveBoulder).toBe(true)
  })

  test("prefers earliest JSON agent by time.created instead of filename order for first-message fallback helpers", async () => {
    // given
    const directory = createTempDir()
    const sessionID = "ses_json_first_agent"
    writeJsonMessage(sessionID, "msg_ffff0000_000001.json", "later-agent")
    writeFileSync(
      join(TEST_MESSAGE_STORAGE, sessionID, "msg_00000000_000999.json"),
      JSON.stringify({
        agent: "earliest-agent",
        model: { providerID: "openai", modelID: "gpt-5.4" },
        time: { created: 10 },
      }),
      "utf-8",
    )

    const { findFirstMessageWithAgent } = await import("../../features/hook-message-injector")

    // when
    const result = findFirstMessageWithAgent(join(TEST_MESSAGE_STORAGE, sessionID))

    // then
    expect(result).toBe("earliest-agent")
    rmSync(directory, { recursive: true, force: true })
  })

  test("prefers newest JSON agent by time.created even when filenames look reversed and timestamps tie-break by filename only", async () => {
    // given
    const directory = createTempDir()
    const plansDir = join(directory, ".sisyphus", "plans")
    mkdirSync(plansDir, { recursive: true })
    const planPath = join(plansDir, "json-random-id-plan.md")
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    mkdirSync(join(directory, ".sisyphus"), { recursive: true })
    writeFileSync(join(directory, ".sisyphus", "boulder.json"), JSON.stringify({
      active_plan: planPath,
      started_at: new Date().toISOString(),
      session_ids: ["ses_root_random"],
      plan_name: "json-random-id-plan",
      agent: "atlas",
    }), "utf-8")
    const sessionID = "ses_child_random"
    const messageDir = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(messageDir, { recursive: true })
    writeFileSync(join(messageDir, "msg_a91f00ab_000001.json"), JSON.stringify({
      agent: "atlas",
      model: { providerID: "openai", modelID: "gpt-5.4" },
      time: { created: 100 },
    }), "utf-8")
    writeFileSync(join(messageDir, "msg_f0e1d2c3_000002.json"), JSON.stringify({
      agent: "compaction",
      model: { providerID: "openai", modelID: "gpt-5.4" },
      time: { created: 200 },
    }), "utf-8")
    writeFileSync(join(messageDir, "msg_d4c3b2a1_000003.json"), JSON.stringify({
      agent: "sisyphus-junior",
      model: { providerID: "openai", modelID: "gpt-5.4" },
      time: { created: 100 },
    }), "utf-8")

    const { getContinuationState } = await import("./continuation-state")

    // when
    const state = await getContinuationState(directory, sessionID, {
      session: {
        get: async ({ path }: { path: { id: string } }) => ({
          data: {
            id: path.id,
            parentID: path.id === sessionID ? "ses_root_random" : undefined,
          },
        }),
      },
    } as never)

    // then
    expect(state.hasActiveBoulder).toBe(false)
  })
})
