import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { omoRunner } from "./run-omo"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function launcher(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-remote-tui-"))
  dirs.push(dir)
  const path = join(dir, "omo.js")
  writeFileSync(path, body)
  return path
}

describe("omoRunner", () => {
  it("#given an npm launcher #when it runs #then the launcher gets the arguments and both streams and the exit code come back", async () => {
    // given
    const omo = launcher(
      "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n'); process.stderr.write('warn\\n'); process.exit(3)",
    )

    // when
    const answer = await omoRunner(omo)(["remote", "devices", "--json"])

    // then
    expect(answer).toEqual({ code: 3, stdout: '["remote","devices","--json"]\n', stderr: "warn\n" })
  })

  it("#given a binary that does not exist #when it runs #then the start failure rejects", async () => {
    // given
    const missing = join(tmpdir(), "omo-remote-tui-missing", "omo")

    // when
    const started = omoRunner(missing)(["remote", "status", "--json"])

    // then
    await expect(started).rejects.toThrow()
  })
})
