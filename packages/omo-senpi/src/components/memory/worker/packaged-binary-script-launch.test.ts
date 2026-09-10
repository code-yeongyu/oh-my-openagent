import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Under the binary runtime, process.execPath is the compiled single-file omo executable. A compiled
// Bun binary ignores a script argument and runs its embedded entrypoint, so `spawn(process.execPath,
// [scriptPath, ...])` does not run the supervisor at all: it boots a phantom omo agent session whose
// "prompt" is the supervisor path, which answers once and exits 0. The parent then sees a clean exit
// with no outcome.json (supervisor_failed) and never advances the transcript cursor. BUN_BE_BUN=1 is
// the documented switch that makes a compiled Bun binary execute the script instead of itself; it is
// pinned here for every process.execPath script launch in the reflection chain (oh-my-openagent#8031).
const CHAIN_FILES = ["spawn-supervisor.ts", "memory-run-supervisor.ts"] as const

interface SpawnCall {
  readonly file: string
  readonly line: number
  readonly text: string
}

function collectExecPathSpawnCalls(file: string): readonly SpawnCall[] {
  const source = readFileSync(join(import.meta.dir, file), "utf8")
  const calls: SpawnCall[] = []
  const pattern = /\bspawn\(\s*process\.execPath\b/g
  let match = pattern.exec(source)
  while (match !== null) {
    const start = source.indexOf("(", match.index)
    let depth = 0
    let end = start
    for (let index = start; index < source.length; index += 1) {
      const character = source[index]
      if (character === "(") depth += 1
      else if (character === ")") {
        depth -= 1
        if (depth === 0) {
          end = index
          break
        }
      }
    }
    calls.push({
      file,
      line: source.slice(0, match.index).split("\n").length,
      text: source.slice(match.index, end + 1),
    })
    match = pattern.exec(source)
  }
  return calls
}

describe("reflection worker script launches through a packaged omo binary", () => {
  describe("#given every spawn(process.execPath, [script, ...]) call in the reflection launch chain", () => {
    describe("#when the spawn options are inspected", () => {
      test("#then each one sets BUN_BE_BUN: \"1\" so a compiled omo binary runs the script instead of itself", () => {
        const offenders = CHAIN_FILES.flatMap(collectExecPathSpawnCalls)
          .filter((call) => !/BUN_BE_BUN:\s*"1"/.test(call.text))
          .map((call) => `${call.file}:${call.line}`)

        expect(offenders).toEqual([])
      })

      test("#then the chain still contains the process.execPath launches this audit is meant to cover", () => {
        const counts = CHAIN_FILES.map((file) => collectExecPathSpawnCalls(file).length)

        expect(counts).toEqual([1, 1])
      })
    })
  })
})
