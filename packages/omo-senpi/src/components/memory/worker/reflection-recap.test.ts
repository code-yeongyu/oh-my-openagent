import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, symlink, rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deliverReflectionCompletion } from "./completion-delivery"
import { recapFixture } from "./reflection-recap.test-support"
import { readReflectionRecap, readReflectionReport } from "./reflection-recap"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "reflection-recap-"))
  roots.push(root)
  return recapFixture(root)
}

test.each([
  { identity: "another-identity" }, { mergedCommitSha: "" }, { runId: "../escape" },
  { outcome: "no_changes" as const }, { outcome: "failed" as const },
  { outcome: "timed_out" as const }, { outcome: "merge_conflict" as const },
])("#given ineligible completion %j #when projected #then no recap exists", async (patch) => {
  const item = await fixture()
  expect(await readReflectionRecap(item.context, { ...item.record, ...patch })).toBeUndefined()
})

test.each([
  { runId: "other" }, { startedAt: "2026-01-01T00:00:00.000Z" },
  { finalizedAt: "2026-01-01T00:00:00.000Z" }, { finalizeOutcome: "failed" },
  { integrationSha: "b".repeat(40) }, { attempt: 2 },
  { validatedChangedPaths: ["../outside"] }, { validatedChangedPaths: ["/absolute"] },
  { validatedChangedPaths: ["reference/\u001bfile"] },
])("#given contradictory ledger %j #when projected #then the legacy notice is retained", async (patch) => {
  const item = await fixture()
  await writeFile(join(item.runDir, "ledger.json"), JSON.stringify({ ...item.ledger, ...patch }))
  expect(await readReflectionRecap(item.context, item.record)).toBeUndefined()
})

test.each([
  { runId: "other" }, { attempt: 2 }, { timedOut: true },
  { childExit: { code: 1, signal: null } }, { childExit: { code: 0, signal: "SIGTERM" } },
])("#given unsuccessful or mismatched attempt %j #when projected #then it is excluded", async (patch) => {
  const item = await fixture()
  await writeFile(join(item.runDir, "outcome.json"), JSON.stringify({ ...item.outcome, ...patch }))
  expect(await readReflectionRecap(item.context, item.record)).toBeUndefined()
})

test.each(["final.json", "abandoned.json"])("#given contradictory %s #when projected #then it is excluded", async (name) => {
  const item = await fixture()
  await writeFile(join(item.runDir, name), JSON.stringify({ version: 1, runId: item.record.runId, outcome: "failed" }))
  expect(await readReflectionRecap(item.context, item.record)).toBeUndefined()
})

test.each(["ledger", "outcome", "both"])("#given missing %s attempt evidence #when projected #then no recap exists", async (missing) => {
  const item = await fixture()
  if (missing !== "outcome") {
    await writeFile(join(item.runDir, "ledger.json"), JSON.stringify({ ...item.ledger, attempt: undefined }))
  }
  if (missing !== "ledger") {
    await writeFile(join(item.runDir, "outcome.json"), JSON.stringify({ ...item.outcome, attempt: undefined }))
  }
  expect(await readReflectionRecap(item.context, item.record)).toBeUndefined()
})

test("#given an integrated ledger without settled phase or final sentinel #when projected #then the live report is available", async () => {
  const item = await fixture()
  expect(await readReflectionRecap(item.context, item.record)).toMatchObject({
    changedPaths: ["reference/synthetic.md"], report: { status: "available", text: item.report },
  })
})

test.each([
  ["empty", Buffer.from(""), "empty_output"], ["unfinished", Buffer.from("unfinished"), "incomplete_output"],
  ["invalid UTF-8", Buffer.from([0xff, 10]), "invalid_utf8"], ["oversized line", Buffer.from("a".repeat(70_000)), "incomplete_output"],
] as const)("#given %s stdout #when read #then it is explicitly unavailable", async (_name, bytes, reason) => {
  const item = await fixture()
  await writeFile(join(item.runDir, "child-stdout.log"), bytes)
  expect(await readReflectionReport(item.runDir)).toEqual({ status: "unavailable", reason })
})

test("#given Markdown whitespace and terminal colors #when read #then only terminal controls are removed", async () => {
  const item = await fixture()
  const expected = "# Recorded changes\n\n  - first   second  \n\tcode\tcolumn\n\n"
  await writeFile(join(item.runDir, "child-stdout.log"), expected.replace("first", "\u001b[31mfirst\u001b[0m"))
  expect(await readReflectionReport(item.runDir)).toMatchObject({
    status: "available",
    text: expected,
    sourceTruncated: false,
  })
})

test("#given short file reads #when read #then every byte is collected from offset zero", async () => {
  const item = await fixture()
  const offsets: number[] = []
  const report = await readReflectionReport(item.runDir, async (file, buffer, offset) => {
    offsets.push(offset)
    return (await file.read(buffer, offset, Math.min(3, buffer.length - offset), offset)).bytesRead
  })
  expect(offsets[0]).toBe(0)
  expect(offsets.length).toBeGreaterThan(1)
  expect(report).toMatchObject({ status: "available", text: item.report })
})

test("#given an interrupted positional read #when retried #then the same offset yields the recorded report", async () => {
  const item = await fixture()
  const offsets: number[] = []
  const report = await readReflectionReport(item.runDir, async (file, buffer, offset) => {
    offsets.push(offset)
    if (offsets.length === 1) throw Object.assign(new Error("interrupted"), { code: "EINTR" })
    return (await file.read(buffer, offset, buffer.length - offset, offset)).bytesRead
  })
  expect(offsets).toEqual([0, 0])
  expect(report).toMatchObject({ status: "available", text: item.report })
})

test.each(["replacement", "size change"])("#given a %s during the read #when checked #then changing output is unavailable", async (change) => {
  const item = await fixture()
  const path = join(item.runDir, "child-stdout.log")
  const report = await readReflectionReport(item.runDir, async (file, buffer, offset) => {
    const read = await file.read(buffer, offset, buffer.length - offset, offset)
    if (change === "replacement") {
      await writeFile(`${path}.replacement`, item.report)
      await rename(`${path}.replacement`, path)
    } else await writeFile(path, "changed\n")
    return read.bytesRead
  })
  expect(report).toEqual({ status: "unavailable", reason: "changing_file" })
})

test("#given oversized stdout #when read #then only complete prefix lines survive", async () => {
  const item = await fixture()
  await writeFile(join(item.runDir, "child-stdout.log"), `prefix\n${"x".repeat(70_000)}\n`)
  expect(await readReflectionReport(item.runDir)).toEqual({
    status: "available", text: "prefix\n", preview: "prefix", sourceTruncated: true,
  })
})

test("#given terminal controls and Korean Markdown #when read #then newlines and readable content survive", async () => {
  const item = await fixture()
  await writeFile(join(item.runDir, "child-stdout.log"), "# 제목\n\n  - \u001b[31m한국어\u001b[0m\n\u001b]0;secret\u0007본문\n")
  expect(await readReflectionReport(item.runDir)).toMatchObject({
    text: "# 제목\n\n  - 한국어\n본문\n", preview: "# 제목\n  - 한국어\n본문",
  })
})

test("#given long Unicode lines #when previewed #then the limit counts code points", async () => {
  const item = await fixture()
  await writeFile(join(item.runDir, "child-stdout.log"), `${"🦊".repeat(700)}\nsecond\nthird\nfourth\n`)
  const report = await readReflectionReport(item.runDir)
  expect(report.status).toBe("available")
  if (report.status === "available") expect(Array.from(report.preview)).toHaveLength(600)
})

test("#given an escaping stdout symlink #when projected #then the report is unavailable without borrowing data", async () => {
  const item = await fixture()
  await rm(join(item.runDir, "child-stdout.log"))
  await symlink(join(item.completionsDir, `${item.record.runId}.json`), join(item.runDir, "child-stdout.log"))
  expect(await readReflectionRecap(item.context, item.record)).toMatchObject({ report: { status: "unavailable", reason: "unsafe_file" } })
})

test("#given missing stdout and an attractive JSONL #when projected #then no alternate artifact is selected", async () => {
  const item = await fixture()
  await rm(join(item.runDir, "child-stdout.log"))
  await writeFile(join(item.runDir, "session.jsonl"), `${JSON.stringify({ text: "DO_NOT_BORROW" })}\n`)
  expect(await readReflectionRecap(item.context, item.record)).toMatchObject({ report: { status: "unavailable", reason: "missing_output" } })
})

test("#given committed stdout #when projected at the existing delivery seam #then its stable key names the generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "reflection-recap-"))
  roots.push(root)
  const fixture = await recapFixture(root)
  const entries: unknown[] = []
  const live = { sessionId: "conversation-a", identityContext: fixture.context,
    api: { appendEntry: (_type: string, data?: unknown) => { entries.push(data) }, registerEntryRenderer() {} } }
  await deliverReflectionCompletion(fixture.completionsDir, fixture.record, live)
  expect(entries[0]).toHaveProperty("recap.key", JSON.stringify([
    fixture.record.identity, fixture.record.runId, fixture.record.startedAt, fixture.record.finishedAt,
  ]))
})
