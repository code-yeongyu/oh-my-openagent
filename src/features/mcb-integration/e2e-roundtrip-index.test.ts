import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  callMcbTool,
  createDefaultArgs,
  createMcbTestClient,
  parseMcbToolResponse,
  type McbTestClient,
} from "./mcb-client-helper"
import { waitForIndexReady } from "./mcb-roundtrip-helpers"

const mcbAvailable = Bun.which("mcb") !== null

describe.skipIf(!mcbAvailable)("mcb-integration: e2e roundtrip index search", () => {
  let testClient: McbTestClient
  let tempDir = ""

  beforeAll(async () => {
    testClient = await createMcbTestClient()
    tempDir = mkdtempSync(join(tmpdir(), "mcb-roundtrip-"))
    writeFileSync(
      join(tempDir, "calculator.ts"),
      "export function calculateTotalRoundtripMarker(items: number[]): number { return items.reduce((sum, item) => sum + item, 0) }\n",
      "utf-8",
    )
  })

  afterAll(async () => {
    await testClient.close()
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  //#given a temporary directory with known code content
  //#when index start, status polling, and code search execute
  //#then indexed code is discoverable by search query
  test("index start then search code performs write-read roundtrip", async () => {
    const collection = `mcb-roundtrip-${Date.now()}`
    const startArgs = {
      ...createDefaultArgs("index"),
      action: "start",
      path: tempDir,
      collection,
      extensions: ["ts"],
    }
    const startResult = await callMcbTool(testClient.client, "index", startArgs)
    expect(startResult.isError).not.toBe(true)

    const ready = await waitForIndexReady(testClient.client, collection, {
      maxWaitMs: 5_000,
      intervalMs: 200,
      minIdleReadyMs: 400,
    })
    expect(ready).toBe(true)

    const found = await searchCodeMarker(testClient, collection)
    expect(found).toBe(true)
  }, 15_000)
})

async function searchCodeMarker(testClient: McbTestClient, collection: string): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const searchArgs = {
      ...createDefaultArgs("search"),
      resource: "code",
      query: "calculateTotalRoundtripMarker",
      collection,
      limit: 10,
    }
    const result = await callMcbTool(testClient.client, "search", searchArgs)
    if (result.isError !== true) {
      const parsed = parseMcbToolResponse(result)
      const payload = typeof parsed === "string" ? parsed : JSON.stringify(parsed)
      if (payload.includes("calculateTotalRoundtripMarker") || /Results\s+found:\s*[1-9]/i.test(payload)) {
        return true
      }
    }
    await Bun.sleep(250)
  }

  return false
}
