import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { callMcbTool, createDefaultArgs, createMcbTestClient, parseMcbToolResponse, type McbTestClient } from "./mcb-client-helper"

const mcbAvailable = Bun.which("mcb") !== null

describe.skipIf(!mcbAvailable)("mcb-integration: e2e tier3 extended operations", () => {
  let testClient: McbTestClient
  let tempDir = ""

  beforeAll(async () => {
    testClient = await createMcbTestClient()
    tempDir = mkdtempSync(join(tmpdir(), "mcb-e2e-"))
    writeFileSync(join(tempDir, "sample.ts"), "export const value = 1\n", "utf-8")
  })

  afterAll(async () => {
    await testClient.close()
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  //#given vcs tool defaults
  //#when list_repositories action runs
  //#then the response payload is returned with valid shape
  test("vcs list_repositories returns parseable payload", async () => {
    const result = await callMcbTool(testClient.client, "vcs", createDefaultArgs("vcs"))
    expect(result.content.length).toBeGreaterThan(0)
    expect(typeof result.content[0]?.text).toBe("string")
  }, 10_000)

  //#given session tool defaults
  //#when list action runs
  //#then the response is parseable or plain text
  test("session list returns parseable payload", async () => {
    const result = await callMcbTool(testClient.client, "session", createDefaultArgs("session"))
    const parsed = parseMcbToolResponse(result)
    if (typeof parsed === "object" && parsed !== null) {
      expect(parsed).toBeDefined()
      return
    }
    expect(typeof parsed).toBe("string")
  }, 10_000)

  //#given validate tool defaults
  //#when analyze action targets a valid file
  //#then mcb returns a payload in expected text envelope
  test("validate analyze returns textual payload for existing file", async () => {
    const args = {
      ...createDefaultArgs("validate"),
      action: "analyze",
      scope: "file",
      path: join(tempDir, "sample.ts"),
    }
    const result = await callMcbTool(testClient.client, "validate", args)
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.content[0]?.type).toBe("text")
  }, 10_000)

  //#given index tool defaults
  //#when start action runs against temporary code directory
  //#then mcb returns a valid response envelope
  test("index start on temp directory returns textual payload", async () => {
    const args = {
      ...createDefaultArgs("index"),
      action: "start",
      path: tempDir,
      collection: `e2e-${Date.now()}`,
      extensions: ["ts"],
    }
    const result = await callMcbTool(testClient.client, "index", args)
    expect(result.content.length).toBeGreaterThan(0)
    expect(typeof result.content[0]?.text).toBe("string")
  }, 10_000)
})
