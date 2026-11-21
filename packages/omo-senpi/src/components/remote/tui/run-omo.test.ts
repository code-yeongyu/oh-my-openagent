import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { KILL_GRACE_MS, omoRunner } from "./run-omo"

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

const LONG = 60_000
const NEVER_EXITS = "process.stdout.write('started\\n'); setInterval(() => {}, 1000)"

describe("omoRunner", () => {
  it("#given an npm launcher #when it runs #then the launcher gets the arguments and both streams and the exit code come back", async () => {
    // given
    const omo = launcher(
      "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n'); process.stderr.write('warn\\n'); process.exit(3)",
    )

    // when
    const answer = await omoRunner(omo)(["remote", "devices", "--json"], { deadlineMs: LONG })

    // then
    expect(answer).toEqual({ code: 3, stdout: '["remote","devices","--json"]\n', stderr: "warn\n" })
  })

  it("#given a binary that does not exist #when it runs #then the start failure rejects", async () => {
    // given
    const missing = join(tmpdir(), "omo-remote-tui-missing", "omo")

    // when
    const started = omoRunner(missing)(["remote", "status", "--json"], { deadlineMs: LONG })

    // then
    await expect(started).rejects.toThrow()
  })

  // The deadline itself is the behavior here, so a short real deadline is the input.
  it("#given a process that never exits #when its deadline passes #then it is stopped and the answer says so", async () => {
    // given
    const omo = launcher(NEVER_EXITS)

    // when
    const answer = await omoRunner(omo)(["remote", "send"], { deadlineMs: 300 })

    // then
    expect(answer.ended).toBe("deadline")
    expect(answer.stdout).toBe("started\n")
  })

  it(
    "#given a process that ignores SIGTERM #when its deadline passes #then it is killed after the grace period and the answer still comes back",
    async () => {
      // given
      const omo = launcher(
        "process.on('SIGTERM', () => {}); process.stdout.write('started\\n'); setInterval(() => {}, 1000)",
      )

      // when
      const answer = await omoRunner(omo)(["remote", "send"], { deadlineMs: 300 })

      // then
      expect(answer.ended).toBe("deadline")
      expect(answer.code).toBeNull()
    },
    KILL_GRACE_MS + 10_000,
  )

  it("#given a process that never exits #when its signal aborts #then it is stopped and the answer says aborted", async () => {
    // given
    const omo = launcher(NEVER_EXITS)
    const controller = new AbortController()

    // when
    const running = omoRunner(omo)(["remote", "send"], { deadlineMs: LONG, signal: controller.signal })
    controller.abort()
    const answer = await running

    // then
    expect(answer.ended).toBe("aborted")
  })

  // Guard G4b (design v8-core r2 B5): only the /remote command may start omo processes through this helper.
  it("#given the package sources #when their imports are read #then only command.ts imports the spawn helper", () => {
    // given
    const src = join(dirname(fileURLToPath(import.meta.url)), "../../..")
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return files(path)
        return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : []
      })

    // when
    const importers = files(src).filter((path) => /from\s+["'][^"']*\/run-omo["']/.test(readFileSync(path, "utf8")))

    // then
    expect(importers.map((path) => relative(src, path).split(sep).join("/"))).toEqual([
      "components/remote/tui/command.ts",
    ])
  })
})
