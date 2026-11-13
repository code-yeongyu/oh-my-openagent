import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { ROOT_TEST_SERIAL_QUARANTINE_PATHS } from "./root-test-serial-quarantine"
import type { TestFastGroup } from "./test-fast"
import {
  basePathIgnorePatterns,
  compareFailures,
  compareUnion,
  junitCases,
  MAX_SHARDS,
  runShards,
  shardCount,
  shardGroups,
} from "./test-shards"

describe("shardCount", () => {
  it("#given a 2-core machine #when no override is set #then it runs one shard", () => {
    expect(shardCount(2, undefined)).toBe(1)
  })

  it("#given a 1-core machine #when no override is set #then it still runs one shard", () => {
    expect(shardCount(1, undefined)).toBe(1)
  })

  it("#given an 8-core machine #when no override is set #then it leaves one core free", () => {
    expect(shardCount(8, undefined)).toBe(7)
  })

  it("#given a 40-core machine #when no override is set #then it caps at MAX_SHARDS", () => {
    expect(shardCount(40, undefined)).toBe(MAX_SHARDS)
  })

  it("#given an explicit override #when it is a positive integer #then it wins over the core count", () => {
    expect(shardCount(40, "3")).toBe(3)
    expect(shardCount(2, "")).toBe(1)
  })

  it("#given an invalid override #when the count is derived #then it refuses", () => {
    expect(() => shardCount(8, "0")).toThrow("OMO_TEST_SHARDS must be a positive integer")
    expect(() => shardCount(8, "2.5")).toThrow("OMO_TEST_SHARDS must be a positive integer")
  })
})

describe("basePathIgnorePatterns", () => {
  it("#given the repository bunfig.toml #when its ignore list is read #then it matches the file's own list", () => {
    // given
    const bunfig = readFileSync(new URL("../bunfig.toml", import.meta.url), "utf8")

    // when
    const patterns = basePathIgnorePatterns(bunfig)

    // then
    expect(patterns).toContain("dist/**")
    expect(patterns).toContain("packages/omo-codex/plugin/**")
    expect(patterns).not.toContain("packages/omo-senpi/**")
  })

  it("#given a bunfig without an ignore list #when it is read #then it refuses", () => {
    expect(() => basePathIgnorePatterns("[test]\n")).toThrow("pathIgnorePatterns must be a string array")
  })
})

describe("shardGroups", () => {
  const plan = shardGroups({
    shards: 3,
    basePatterns: ["dist/**"],
    timingsFiles: [".github/test-timings/a.json", ".github/test-timings/b.json"],
    reportDir: "/r",
  })

  it("#given the quarantine #when groups are built #then the serial group runs exactly the quarantined files", () => {
    expect(plan.serial.args.filter((arg) => arg.startsWith("./"))).toEqual(
      ROOT_TEST_SERIAL_QUARANTINE_PATHS.map((path) => `./${path}`),
    )
    expect(plan.serial.args).toContain("--reporter-outfile=/r/serial-quarantine.xml")
  })

  it("#given 3 shards #when groups are built #then each shard names its slice, every timings file and its report", () => {
    expect(plan.shards.map((group) => group.name)).toEqual(["shard-1", "shard-2", "shard-3"])
    plan.shards.forEach((group, index) => {
      expect(group.args).toContain(`--shard=${index + 1}/3`)
      expect(group.args).toContain("--timings=.github/test-timings/a.json")
      expect(group.args).toContain("--timings=.github/test-timings/b.json")
      expect(group.args).toContain(`--reporter-outfile=/r/shard-${index + 1}.xml`)
      expect(group.args).not.toContain("--parallel")
    })
  })

  it("#given the base patterns #when shards are built #then each shard ignores them plus every quarantined file", () => {
    const ignored = plan.shards[0]?.args.filter((arg) => arg.startsWith("--path-ignore-patterns=")) ?? []
    expect(ignored).toEqual(
      ["dist/**", ...ROOT_TEST_SERIAL_QUARANTINE_PATHS].map((pattern) => `--path-ignore-patterns=${pattern}`),
    )
  })
})

describe("junitCases, compareUnion and compareFailures", () => {
  const xml = (cases: string[], failed: string[] = []) =>
    `<testsuites>${cases
      .map((name) =>
        failed.includes(name)
          ? `<testcase name="${name}" classname="d" file="f.test.ts" time="0">\n<failure type="AssertionError" message="x">x</failure>\n</testcase>`
          : `<testcase name="${name}" classname="d" file="f.test.ts" time="0" />`,
      )
      .join("\n")}</testsuites>`
  const ids = (text: string) => junitCases(text).map((c) => c.id)

  it("#given a bun JUnit report with a passing and a failing case #when cases are read #then each is file > classname > name with its outcome", () => {
    expect(junitCases(xml(["a", "b"], ["b"]))).toEqual([
      { id: "f.test.ts > d > a", failed: false },
      { id: "f.test.ts > d > b", failed: true },
    ])
  })

  it("#given shards that cover the serial set once #when compared #then nothing is missing, extra or duplicated", () => {
    const result = compareUnion(ids(xml(["a", "b", "c"])), [ids(xml(["a"])), ids(xml(["b", "c"]))])
    expect(result).toEqual({ missing: [], extra: [], duplicated: [] })
  })

  it("#given shards that drop one test and run another twice #when compared #then both are reported", () => {
    const result = compareUnion(ids(xml(["a", "b", "c"])), [ids(xml(["a", "b"])), ids(xml(["b", "x"]))])
    expect(result).toEqual({
      missing: ["f.test.ts > d > c"],
      extra: ["f.test.ts > d > x"],
      duplicated: ["f.test.ts > d > b"],
    })
  })

  it("#given a test that fails only in one run #when failures are compared #then the side it failed on is reported", () => {
    const serial = junitCases(xml(["a", "b", "c"], ["a", "b"]))
    const shards = junitCases(xml(["a", "b", "c"], ["a", "c"]))
    expect(compareFailures(serial, shards)).toEqual({
      onlySerial: ["f.test.ts > d > b"],
      onlyShards: ["f.test.ts > d > c"],
    })
  })
})

describe("runShards", () => {
  const group = (name: string): TestFastGroup => ({ name, args: [] })
  const groups = { serial: group("serial-quarantine"), shards: [group("shard-1"), group("shard-2")] }

  it("#given the serial group #when shards run #then no shard starts before the serial group exits", async () => {
    // given
    const events: string[] = []
    let releaseSerial = () => {}
    const serialDone = new Promise<void>((resolve) => {
      releaseSerial = resolve
    })
    const spawn = async (g: TestFastGroup) => {
      events.push(`start ${g.name}`)
      if (g.name === "serial-quarantine") await serialDone
      events.push(`exit ${g.name}`)
      return 0
    }

    // when
    const run = runShards(spawn, groups, () => {})
    expect(events).toEqual(["start serial-quarantine"])
    releaseSerial()
    const exit = await run

    // then
    expect(exit).toBe(0)
    expect(events.slice(0, 2)).toEqual(["start serial-quarantine", "exit serial-quarantine"])
    expect(events).toContain("start shard-2")
  })

  it("#given one failing shard #when the run ends #then it exits 1 and every shard still ran", async () => {
    const ran: string[] = []
    const exit = await runShards(
      async (g) => {
        ran.push(g.name)
        return g.name === "shard-2" ? 1 : 0
      },
      groups,
      () => {},
    )
    expect(exit).toBe(1)
    expect(ran).toEqual(["serial-quarantine", "shard-1", "shard-2"])
  })

  it("#given a failing serial group #when the run ends #then it exits 1", async () => {
    const exit = await runShards(
      async (g) => (g.name === "serial-quarantine" ? 1 : 0),
      groups,
      () => {},
    )
    expect(exit).toBe(1)
  })

  it("#given a shard that fails to start #when the run ends #then survivors are shut down and the error propagates", async () => {
    let shutdown = 0
    const run = runShards(
      async (g) => {
        if (g.name === "shard-1") throw new Error("spawn failed")
        return 0
      },
      groups,
      () => {},
      () => {
        shutdown += 1
      },
    )
    await expect(run).rejects.toThrow("spawn failed")
    expect(shutdown).toBe(1)
  })
})
