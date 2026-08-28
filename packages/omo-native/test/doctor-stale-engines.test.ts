import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  classifyEngineProcesses,
  formatStaleEngineLines,
  reapStaleEngines,
} from "../bin/lib/doctor.js"

const LAUNCHER = join(resolve(fileURLToPath(new URL("..", import.meta.url))), "bin", "omo.js")

type Entry = {
  pid: number
  ppid: number
  elapsed: string
  tty: string
  command: string
}

const ENGINE = "/Users/dev/.bun/install/global/node_modules/omo-ai/node_modules/@code-yeongyu/senpi/dist/cli.js"
const PLUGIN = "/Users/dev/.bun/install/global/node_modules/omo-ai/plugin"

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    pid: 75183,
    ppid: 1,
    elapsed: "1-02:30:11",
    tty: "ttys013",
    command: `bun ${ENGINE} --extension ${PLUGIN}`,
    ...overrides,
  }
}

describe("omo doctor stale engine detection", () => {
  describe("#given a process list containing every engine shape", () => {
    describe("#when the engines are classified", () => {
      test("#then only reparented interactive engines count as stale", () => {
        const orphan = entry({ pid: 75183 })
        const attached = entry({ pid: 12811, ppid: 12806, tty: "ttys002" })
        const rpc = entry({ pid: 4242, command: `bun ${ENGINE} --mode rpc` })
        const appServer = entry({ pid: 4243, command: `bun ${ENGINE} --mode app-server` })
        const unrelated = entry({ pid: 4244, command: "bun /Users/dev/other/dist/cli.js" })

        const result = classifyEngineProcesses([orphan, attached, rpc, appServer, unrelated])

        expect(result.stale.map((process) => process.pid)).toEqual([75183])
        expect(result.attached.map((process) => process.pid)).toEqual([12811])
        expect(result.managed.map((process) => process.pid)).toEqual([4242, 4243])
      })

      test("#then the launcher's own descendants are never reported as stale", () => {
        // A doctor run inside a live session sees its own engine; reporting it would tell the user
        // to reap the session they are typing into.
        const live = entry({ pid: 999, ppid: 998, tty: "ttys004" })
        expect(classifyEngineProcesses([live]).stale).toEqual([])
      })
    })
  })

  describe("#given stale engines were found", () => {
    describe("#when the report is rendered", () => {
      test("#then each line carries pid, age, tty and the explicit reap command", () => {
        const lines = formatStaleEngineLines([entry({ pid: 90387, elapsed: "21:44:07", tty: "ttys005" })])
        const rendered = lines.join("\n")
        expect(rendered).toContain("WARN")
        expect(rendered).toContain("90387")
        expect(rendered).toContain("21:44:07")
        expect(rendered).toContain("ttys005")
        expect(rendered).toContain("omo doctor --reap 90387")
      })

      test("#then no stale engines render no lines at all", () => {
        expect(formatStaleEngineLines([])).toEqual([])
      })
    })
  })

  describe("#given an explicit reap request", () => {
    describe("#when the named pid is a reparented interactive engine", () => {
      test("#then exactly that pid is signaled", () => {
        const signaled: Array<{ pid: number; signal: string }> = []
        const result = reapStaleEngines(["75183"], {
          list: () => [entry({ pid: 75183 }), entry({ pid: 90387 })],
          kill: (pid: number, signal: string) => signaled.push({ pid, signal }),
        })

        expect(signaled).toEqual([{ pid: 75183, signal: "SIGTERM" }])
        expect(result.failed).toBe(false)
        expect(result.lines.join("\n")).toContain("75183")
      })
    })

    describe("#when the named pid is an attached or managed engine", () => {
      for (const [label, unsafe] of [
        ["an rpc engine", entry({ pid: 4242, command: `bun ${ENGINE} --mode rpc` })],
        ["an app-server engine", entry({ pid: 4243, command: `bun ${ENGINE} --mode app-server` })],
        ["a live attached engine", entry({ pid: 12811, ppid: 12806 })],
      ] as const) {
        test(`#then ${label} is refused and nothing is signaled`, () => {
          const signaled: number[] = []
          const result = reapStaleEngines([String(unsafe.pid)], {
            list: () => [unsafe],
            kill: (pid: number) => signaled.push(pid),
          })

          expect(signaled).toEqual([])
          expect(result.failed).toBe(true)
          expect(result.lines.join("\n")).toContain("refusing")
        })
      }
    })

    describe("#when the named pid is not an omo engine at all", () => {
      test("#then it is refused rather than killed", () => {
        const signaled: number[] = []
        const result = reapStaleEngines(["1"], {
          list: () => [entry({ pid: 75183 })],
          kill: (pid: number) => signaled.push(pid),
        })

        expect(signaled).toEqual([])
        expect(result.failed).toBe(true)
        expect(result.lines.join("\n")).toContain("refusing")
      })
    })

    describe("#when no pid is given", () => {
      test("#then nothing is signaled and the explicit form is explained", () => {
        const signaled: number[] = []
        const result = reapStaleEngines([], {
          list: () => [entry({ pid: 75183 })],
          kill: (pid: number) => signaled.push(pid),
        })

        expect(signaled).toEqual([])
        expect(result.failed).toBe(true)
        expect(result.lines.join("\n")).toContain("omo doctor --reap <pid>")
      })
    })

    describe("#when the real launcher is asked to reap a live non-engine pid", () => {
      test("#then it refuses, exits non-zero, and leaves the process alone", () => {
        // Driven against the real `ps` on this machine with the test runner's own pid, which is
        // never an orphaned engine: the refusal is the whole safety contract.
        const result = spawnSync(process.execPath, [LAUNCHER, "doctor", "--reap", String(process.pid)], {
          encoding: "utf8",
        })

        expect(result.status).toBe(1)
        expect(`${result.stdout}${result.stderr}`).toContain("refusing")
        expect(process.kill(process.pid, 0)).toBe(true)
      })
    })

    describe("#when several pids are named and one is unsafe", () => {
      test("#then the safe pid is still reaped and the unsafe one is refused", () => {
        const signaled: number[] = []
        const result = reapStaleEngines(["75183", "4242"], {
          list: () => [entry({ pid: 75183 }), entry({ pid: 4242, command: `bun ${ENGINE} --mode rpc` })],
          kill: (pid: number) => signaled.push(pid),
        })

        expect(signaled).toEqual([75183])
        expect(result.failed).toBe(true)
      })
    })

    describe("#when a pid is spelled as something other than a positive integer", () => {
      for (const spelling of ["0", "-1", "abc", "12.5", ""]) {
        test(`#then ${JSON.stringify(spelling)} is refused before any process lookup`, () => {
          const signaled: number[] = []
          let listed = 0
          const result = reapStaleEngines([spelling], {
            list: () => {
              listed += 1
              return [entry({ pid: 75183 })]
            },
            kill: (pid: number) => signaled.push(pid),
          })

          expect(signaled).toEqual([])
          expect(result.failed).toBe(true)
          expect(listed).toBe(0)
        })
      }
    })
  })
})
