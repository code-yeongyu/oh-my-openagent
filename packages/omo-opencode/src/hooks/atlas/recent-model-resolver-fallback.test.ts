import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { resolveRecentPromptContextForSession } from "./recent-model-resolver"
import type { ModelInfo } from "./types"

const testDirs: string[] = []

function findNearestTestMessage(messageDir: string): { model?: ModelInfo; tools?: Record<string, boolean> } | null {
  const [message] = readdirSync(messageDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      const content = readFileSync(join(messageDir, fileName), "utf-8")
      const parsed = JSON.parse(content) as { model?: ModelInfo; tools?: Record<string, boolean>; time?: { created?: number } }
      return {
        message: parsed,
        createdAt: parsed.time?.created ?? Number.NEGATIVE_INFINITY,
        fileName,
      }
    })
    .sort((left, right) => right.createdAt - left.createdAt || right.fileName.localeCompare(left.fileName))

  return message?.message ?? null
}

afterAll(() => {
  while (testDirs.length > 0) {
    const directory = testDirs.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("resolveRecentPromptContextForSession fallback ordering", () => {
  test("uses JSON fallback ordered by time.created when SDK messages fail", async () => {
    // given
    const sessionID = "ses_recent_model_fallback"
    const directory = mkdtempSync(join(tmpdir(), "recent-model-fallback-dir-"))
    const storageRoot = mkdtempSync(join(tmpdir(), "recent-model-fallback-storage-"))
    testDirs.push(directory)
    testDirs.push(storageRoot)
    const messageDir = join(storageRoot, sessionID)
    mkdirSync(messageDir, { recursive: true })
    writeFileSync(join(messageDir, "msg_ffff0000_000001.json"), JSON.stringify({
      agent: "atlas",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      tools: { read: true },
      time: { created: 10 },
    }), "utf-8")
    writeFileSync(join(messageDir, "msg_00000000_000999.json"), JSON.stringify({
      agent: "atlas",
      model: { providerID: "openai", modelID: "gpt-5.4" },
      tools: { edit: true },
      time: { created: 100 },
    }), "utf-8")

    const ctx = {
      client: {
        session: {
          messages: async () => {
            throw new Error("sdk ordering unavailable")
          },
        },
      },
    }

    // when
    const result = await resolveRecentPromptContextForSession(ctx as never, sessionID, {
      isSqliteBackend: () => false,
      getMessageDir: () => messageDir,
      findNearestMessageWithFields: findNearestTestMessage,
      findNearestMessageWithFieldsFromSDK: async () => null,
    })

    // then
    expect(result.model).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
    expect(result.tools).toEqual({ edit: true })
  })
})
