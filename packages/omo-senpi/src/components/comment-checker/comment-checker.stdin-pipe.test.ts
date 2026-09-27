import { describe, expect, it } from "bun:test"
import { chmodSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { createTempCwd } from "./comment-checker.test-support"

const RUNNER_URL = new URL("./runner.ts", import.meta.url).href
const PAYLOAD_SIZES = [1_000, 1_000_000]
const ROUNDS_PER_SIZE = 5

function writeShellChecker(name: string, body: string): string {
  const path = join(createTempCwd(), name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

// The checker runs in its own process so an unhandled stdin 'error' event ends that process
// (exit code 1, "Unhandled 'error' event") instead of the test runner.
async function runCheckerRounds(binaryPath: string): Promise<{ exitCode: number; results: unknown[]; stderr: string }> {
  const program = `
    const { defaultRunCommentChecker } = await import(${JSON.stringify(RUNNER_URL)})
    const results = []
    for (const size of ${JSON.stringify(PAYLOAD_SIZES)}) {
      for (let round = 0; round < ${ROUNDS_PER_SIZE}; round += 1) {
        results.push(await defaultRunCommentChecker({
          binaryPath: ${JSON.stringify(binaryPath)},
          hookInput: {
            session_id: "session-1",
            tool_name: "write",
            transcript_path: "",
            cwd: ".",
            hook_event_name: "PostToolUse",
            tool_input: { file_path: "src/plan.md", content: "x".repeat(size) },
          },
        }))
      }
    }
    console.log(JSON.stringify(results))
  `
  const child = Bun.spawn([process.execPath, "-e", program], {
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(30_000),
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  const lastLine = stdout.trim().split("\n").at(-1) ?? ""
  return { exitCode, results: lastLine.startsWith("[") ? JSON.parse(lastLine) : [], stderr }
}

const EMPTY_ROUNDS = Array.from({ length: PAYLOAD_SIZES.length * ROUNDS_PER_SIZE }, () => ({ hasComments: false, message: "" }))

describe("comment-checker child stdin (#6396)", () => {
  it("#given a checker binary that exits without reading stdin #when edits of any size are checked #then the host survives and every check is empty", async () => {
    // given
    const binaryPath = process.platform === "win32" ? process.execPath : writeShellChecker("dead-checker", "exit 0")

    // when
    const { exitCode, results, stderr } = await runCheckerRounds(binaryPath)

    // then
    expect({ exitCode, results, stderr: stderr.includes("EPIPE") || stderr.includes("EOF") ? stderr : "" }).toEqual({
      exitCode: 0,
      results: EMPTY_ROUNDS,
      stderr: "",
    })
  }, 60_000)

  it.skipIf(process.platform === "win32")(
    "#given a checker that reads all of stdin and reports comments #when edits of any size are checked #then exit-code-2 feedback still arrives",
    async () => {
      // given
      const binaryPath = writeShellChecker("reporting-checker", "cat >/dev/null\necho 'COMMENT/DOCSTRING DETECTED' >&2\nexit 2")

      // when
      const { exitCode, results } = await runCheckerRounds(binaryPath)

      // then
      expect({ exitCode, results }).toEqual({
        exitCode: 0,
        results: EMPTY_ROUNDS.map(() => ({ hasComments: true, message: "COMMENT/DOCSTRING DETECTED\n" })),
      })
    },
    60_000,
  )
})
