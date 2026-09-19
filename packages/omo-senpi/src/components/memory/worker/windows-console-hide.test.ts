import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Every process in the reflection/dream launch chain runs without an inherited console on win32:
// the supervisor is spawned detached, and its descendants inherit that console-less state. A
// console-subsystem child created without CREATE_NO_WINDOW therefore gets a FRESH visible console,
// which the user sees as an empty terminal window flashing open and closed. windowsHide is the flag
// that suppresses it, so it is pinned here for the whole chain.
const CHAIN_FILES = ["spawn-supervisor.ts", "memory-run-supervisor.ts", "supervisor-process-identity.ts"] as const

interface SpawnCall {
  readonly file: string
  readonly line: number
  readonly text: string
}

function collectSpawnCalls(file: string): readonly SpawnCall[] {
  const source = readFileSync(join(import.meta.dir, file), "utf8")
  const calls: SpawnCall[] = []
  const pattern = /\bspawn(?:Sync)?\(/g
  let match = pattern.exec(source)
  while (match !== null) {
    const start = match.index + match[0].length - 1
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

describe("reflection worker win32 console suppression", () => {
  describe("#given the detached reflection launch chain", () => {
    describe("#when every spawn call in the chain is inspected", () => {
      test("#then each one passes windowsHide: true", () => {
        const offenders = CHAIN_FILES.flatMap(collectSpawnCalls)
          .filter((call) => !call.text.includes("windowsHide: true"))
          .map((call) => `${call.file}:${call.line}`)

        expect(offenders).toEqual([])
      })

      test("#then the chain still contains the spawn calls this audit is meant to cover", () => {
        const counts = CHAIN_FILES.map((file) => collectSpawnCalls(file).length)

        expect(counts).toEqual([1, 2, 2])
      })
    })
  })

  describe("#given the supervisor's bootstrap and model child spawn sites", () => {
    describe("#when their detachment options are inspected", () => {
      test("#then the bootstrap spawn derives detachment from the runtime platform instead of staying detached everywhere", () => {
        // windowsHide alone does not suppress the window in a Windows Terminal default-terminal
        // setup while the bootstrap stays detached on win32; POSIX must keep the detached process
        // group because the group kill targets it.
        const bootstrapSpawn = collectSpawnCalls("memory-run-supervisor.ts").find((call) =>
          call.text.includes("--child-bootstrap"),
        )

        expect(bootstrapSpawn).toBeDefined()
        expect(bootstrapSpawn?.text).toContain('detached: platform !== "win32"')
        expect(bootstrapSpawn?.text).not.toContain("detached: true")
      })

      test("#then the model child spawn stays attached to its bootstrap", () => {
        const modelChildSpawn = collectSpawnCalls("memory-run-supervisor.ts").find(
          (call) => !call.text.includes("--child-bootstrap"),
        )

        expect(modelChildSpawn).toBeDefined()
        expect(modelChildSpawn?.text).toContain("detached: false")
      })
    })
  })
})
