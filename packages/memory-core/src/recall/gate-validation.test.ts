import { afterEach, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PendingNudges } from "./gate"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

it("#given a hand-edited payload with an invalid hint #when taken #then nothing returns and the file is deleted", async () => {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "recall-pending-validation-")))
  tempDirs.push(dir)
  await writeFile(
    join(dir, "session-1.json"),
    JSON.stringify({
      version: 1,
      sessionId: "session-1",
      compactionEpoch: 0,
      writtenAt: new Date().toISOString(),
      nudges: [{ path: "reference/a.md", hint: "password=hunter2" }],
    }),
    "utf8",
  )

  const taken = await new PendingNudges(dir).take("session-1", { currentEpoch: 0 })

  expect(taken).toEqual([])
  expect(await readdir(dir)).toEqual([])
})
