import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runAdapterConformance } from "../../adapter/conformance"
import { testAdapterConformance } from "../../adapter/conformance-bun"
import type { UploadFile } from "../../adapter/contract"
import { FakeSlackServer } from "./testing/fake-server"
import { slackFixtures } from "./testing/fixtures"
import { adapterFor } from "./testing/harness"

let server: FakeSlackServer
let dir: string
let files: UploadFile[]

beforeAll(() => {
  server = new FakeSlackServer()
  dir = mkdtempSync(join(tmpdir(), "omo-gateway-slack-conformance-"))
  files = ["first.txt", "second.txt", "third.txt"].map((title) => {
    const path = join(dir, title)
    writeFileSync(path, `contents of ${title}\n`)
    return { path, title }
  })
})

afterAll(() => {
  server.stop()
  rmSync(dir, { recursive: true, force: true })
})

testAdapterConformance(
  "the slack adapter (user token profile) against the fake Slack server",
  () => adapterFor(server, "user"),
  () => slackFixtures(server, files),
)

testAdapterConformance(
  "the slack adapter (app token profile) against the fake Slack server",
  () => adapterFor(server, "bot"),
  () => slackFixtures(server, files),
)

test("every conformance check passes (none skipped) on both profiles, and thread archiving is refused honestly", async () => {
  for (const kind of ["user", "bot"] as const) {
    const report = await runAdapterConformance(() => adapterFor(server, kind), slackFixtures(server, files))
    expect(report.checks.filter((check) => check.status !== "pass").map((check) => `${kind} ${check.id}: ${check.detail}`)).toEqual([])
    expect(report.checks.find((check) => check.id === "capability_refusals")?.detail).toContain("thread_archive")
  }
})
