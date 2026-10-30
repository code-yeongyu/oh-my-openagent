import { describe, expect, test } from "bun:test"
import {
  classifyRetiredPayloadEngines,
  formatRetiredPayloadLines,
  parseElapsedSeconds,
} from "../bin/lib/doctor.js"

type Entry = {
  pid: number
  ppid: number
  elapsed: string
  tty: string
  command: string
}

const ENGINE = "/Users/dev/.bun/install/global/node_modules/omo-ai/node_modules/@code-yeongyu/senpi/dist/cli.js"
const PLUGIN = "/Users/dev/.bun/install/global/node_modules/omo-ai/plugin"
const NOW_MS = Date.parse("2026-09-09T15:51:00Z")
const PAYLOAD_MTIME_MS = Date.parse("2026-09-09T06:30:00Z")

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    pid: 60871,
    ppid: 4210,
    elapsed: "02:00:00",
    tty: "ttys013",
    command: `bun ${ENGINE} --extension ${PLUGIN}`,
    ...overrides,
  }
}

describe("parseElapsedSeconds", () => {
  test("#given ps etime spellings #when parsed #then minutes, hours and days are all accepted", () => {
    expect(parseElapsedSeconds("05:12")).toBe(312)
    expect(parseElapsedSeconds("1:02:03")).toBe(3_723)
    expect(parseElapsedSeconds("2-03:04:05")).toBe(183_845)
  })

  test("#given an unparsable etime #when parsed #then it yields undefined instead of a wrong number", () => {
    expect(parseElapsedSeconds("-")).toBeUndefined()
    expect(parseElapsedSeconds("")).toBeUndefined()
  })
})

const payloadMtimes = (mtimeByDir: Record<string, number>) => (dir: string) => mtimeByDir[dir]

describe("classifyRetiredPayloadEngines", () => {
  test("#given an engine older than the payload it loads #when classified #then it is reported as retired", () => {
    // given: started 2026-09-09T05:51Z, before the 06:30Z payload write
    const entries = [entry({ elapsed: "10:00:00" })]

    // when
    const retired = classifyRetiredPayloadEngines(entries, {
      payloadMtimeMs: payloadMtimes({ [PLUGIN]: PAYLOAD_MTIME_MS }),
      nowMs: NOW_MS,
    })

    // then
    expect(retired.map((item) => item.pid)).toEqual([60871])
  })

  test("#given an engine started after its payload was written #when classified #then it is left alone", () => {
    // given: started 2026-09-09T13:51Z, after the payload write
    const entries = [entry({ elapsed: "02:00:00" })]

    // when
    const retired = classifyRetiredPayloadEngines(entries, {
      payloadMtimeMs: payloadMtimes({ [PLUGIN]: PAYLOAD_MTIME_MS }),
      nowMs: NOW_MS,
    })

    // then
    expect(retired).toEqual([])
  })

  test("#given two installs on one machine #when classified #then each engine is judged against its own payload", () => {
    // given
    const runtimeDir = "/Users/dev/.omo/binary-runtime/0.0.0-omob.abc.def/plugin"
    const entries = [
      entry({ pid: 100, elapsed: "10:00:00" }),
      entry({ pid: 200, elapsed: "10:00:00", command: `bun ${ENGINE} --extension ${runtimeDir}` }),
    ]

    // when: only the global install was replaced under its process
    const retired = classifyRetiredPayloadEngines(entries, {
      payloadMtimeMs: payloadMtimes({ [PLUGIN]: PAYLOAD_MTIME_MS, [runtimeDir]: Date.parse("2026-09-01T00:00:00Z") }),
      nowMs: NOW_MS,
    })

    // then
    expect(retired.map((item) => item.pid)).toEqual([100])
  })

  test("#given an unparsable age, a non-engine process, no payload flag or an unreadable payload #when classified #then none is reported", () => {
    // given
    const entries = [
      entry({ pid: 1, elapsed: "-" }),
      entry({ pid: 2, elapsed: "10:00:00", command: "bun /Users/dev/project/script/build.ts" }),
      entry({ pid: 3, elapsed: "10:00:00", command: `bun ${ENGINE}` }),
      entry({ pid: 4, elapsed: "10:00:00", command: `bun ${ENGINE} --extension /gone/plugin` }),
    ]

    // when
    const retired = classifyRetiredPayloadEngines(entries, {
      payloadMtimeMs: payloadMtimes({ [PLUGIN]: PAYLOAD_MTIME_MS }),
      nowMs: NOW_MS,
    })

    // then
    expect(retired).toEqual([])
  })
})

describe("formatRetiredPayloadLines", () => {
  test("#given no retired engine #when formatted #then the report stays silent", () => {
    expect(formatRetiredPayloadLines([])).toEqual([])
  })

  test("#given a retired engine #when formatted #then the pid is named with a restart instruction and no reap hint", () => {
    // when
    const lines = formatRetiredPayloadLines([entry({ pid: 8532, elapsed: "1-05:12:00" })])

    // then
    expect(lines[0]).toContain("engine pid 8532")
    expect(lines[0]).toContain("started before this payload was installed")
    expect(lines.at(-1)).toContain("restart those sessions")
    expect(lines.join("\n")).not.toContain("--reap")
  })
})
