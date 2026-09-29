import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runAdapterConformance } from "../../adapter/conformance"
import { testAdapterConformance } from "../../adapter/conformance-bun"
import type { UploadFile } from "../../adapter/contract"
import { FakeDiscordServer } from "./testing/fake-server"
import { adapterFor } from "./testing/harness"

let server: FakeDiscordServer
let dir: string
let files: UploadFile[]

beforeAll(() => {
  server = new FakeDiscordServer()
  dir = mkdtempSync(join(tmpdir(), "omo-gateway-discord-conformance-"))
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
  "the discord adapter against the fake Discord server",
  () => adapterFor(server),
  () => server.fixtures(files),
)

test("every conformance check runs (none skipped) on the discord adapter", async () => {
  const report = await runAdapterConformance(() => adapterFor(server), server.fixtures(files))
  expect(report.checks.filter((check) => check.status !== "pass")).toEqual([])
})
