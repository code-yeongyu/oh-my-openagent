import { expect, onTestFinished, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { FactsPayload, TranscriptEntry } from "@oh-my-opencode/memory-core"
import { validateAgreementSource } from "@oh-my-opencode/memory-core"

import { createFactsAgreementTool } from "./facts-agreement-tool"

const message = (kind: "user" | "assistant", id: string): TranscriptEntry => ({
  kind, text: "Use the fixture convention", captured_at: "2026-10-01T00:00:00.000Z",
  source_line_id: `${id}:line`, source_message_id: id,
})
const payload: FactsPayload = {
  version: 1, identity: "fixture", today: "2026-10-01", knownPeople: [],
  primaryHuman: { slug: "human", aliases: [] }, agreements: [],
  entries: [{
    version: 1, identity: "fixture", sessionId: "session-a", conversationId: "session-a",
    enqueuedAt: "2026-10-01T00:00:00.000Z",
    range: { start_message_id: "u1", end_message_id: "a1", start_line: 0, end_snapshot_line: 2 },
    lead: message("user", "lead"),
    entries: [message("user", "u1"), message("assistant", "a1")],
  }],
}
const params = (messageId: string, sessionId = "session-a") => ({
  action: "new" as const, applies: "global" as const, text: "Use the fixture convention",
  date: "2026-10-01", source: { sessionId, messageId },
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agreement-source-"))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const extractionPath = join(root, "agreements.jsonl")
  const input = { extractionPath, knownIds: new Set<string>(), payload }
  return { tool: createFactsAgreementTool(input), extractionPath }
}

test("record_agreement binds only a user message in the actual payload", async () => {
  const { tool, extractionPath } = await fixture()
  expect((await tool.execute("tool-1", params("u1"))).isError).not.toBe(true)
  expect(JSON.parse((await readFile(extractionPath, "utf8")).trim()).source).toEqual({
    sessionId: "session-a", messageId: "u1",
  })
})

test("assistant messages, lead context and foreign sessions cannot supply event identity", async () => {
  const { tool } = await fixture()
  for (const candidate of [params("a1"), params("lead"), params("missing"), params("u1", "foreign")]) {
    expect((await tool.execute("tool-1", candidate)).isError).toBe(true)
  }
})

test("source validation identifies the actual failing record index", () => {
  expect(() => validateAgreementSource(params("missing"), payload, 2)).toThrow(/record 3:/)
  const { source: _source, ...unsourced } = params("u1")
  expect(() => validateAgreementSource(unsourced, { ...payload, agreementEventVersion: 1 }, 1)).toThrow(/record 2:/)
  expect(() => validateAgreementSource(unsourced, payload)).not.toThrow()
})
