import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const cli = fileURLToPath(new URL("./ci-shard-coverage.ts", import.meta.url))

function withFixture(check: (cwd: string) => void): void {
  const cwd = mkdtempSync(join(tmpdir(), "ci-shard-coverage-"))
  try {
    writeFileSync(
      join(cwd, "bunfig.win2.parallel.toml"),
      '[test]\npathIgnorePatterns = ["omit-*/**", "packages/omo-senpi*/**", "exact.test.ts"]\n',
    )
    writeFileSync(join(cwd, "bunfig.toml"), '[test]\npathIgnorePatterns = ["packages/omo-senpi/ignored/**"]\n')
    for (const file of [
      ".dot.test.ts",
      "deep/a_test.tsx",
      "deep/b.spec.JS",
      "c_spec.jsx",
      "d.test.mjs",
      "e_test.cjs",
      "f.spec.mts",
      "g_spec.cts",
      "exact.test.ts",
      "omit-one/skip.test.ts",
      "deep/node_modules/dependency.test.ts",
      ".hidden/skip.test.ts",
      "not.test.txt",
      "not.test.extra.ts",
      "packages/other/irrelevant.ts",
      "packages/omo-senpi/a.test.ts",
      "packages/omo-senpi/ignored/b.spec.ts",
      "packages/omo-senpi-extra/c_test.ts",
    ]) {
      const path = join(cwd, file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, "")
    }
    check(cwd)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

function record(cwd: string, part: string, files: readonly string[]): void {
  const dir = join(cwd, `ci-shard-${part}`)
  mkdirSync(dir)
  writeFileSync(
    join(dir, "ci-shard-record.json"),
    JSON.stringify({ version: 1, files: Object.fromEntries(files.map((f) => [f, 0])) }),
  )
}

function windowsRecord(cwd: string, artifact: string, name: string, files: readonly string[]): void {
  const dir = join(cwd, artifact)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${name}.timings.json`),
    JSON.stringify({ version: 1, files: Object.fromEntries(files.map((f) => [f, 0])) }),
  )
}

function run(cwd: string, mode: "root" | "senpi" | "windows-senpi" | "merge", output?: string) {
  return spawnSync(process.execPath, [cli, mode, ".", ...(output ? [output] : [])], { cwd, encoding: "utf8" })
}

const rootOne = [".dot.test.ts", "deep/a_test.tsx", "deep/b.spec.JS", "c_spec.jsx"]
const rootTwo = ["d.test.mjs", "e_test.cjs", "f.spec.mts", "g_spec.cts"]

test("#given both groups' exact per-file records #when merged #then the reusable snapshot includes only covered files", () => {
  withFixture((cwd) => {
    // given
    const senpiOne = "packages/omo-senpi/a.test.ts"
    const senpiTwo = "packages/omo-senpi-extra/c_test.ts"
    record(cwd, "root-remainder-1", rootOne)
    record(cwd, "root-remainder-2", rootTwo)
    record(cwd, "senpi-one", [senpiOne])
    record(cwd, "senpi-two", [senpiTwo])

    // when
    const result = run(cwd, "merge", "merged.json")

    // then
    expect(result.status, result.stderr).toBe(0)
    const merged: unknown = JSON.parse(readFileSync(join(cwd, "merged.json"), "utf8"))
    expect(merged).toEqual({
      version: 1,
      files: Object.fromEntries([...rootOne, ...rootTwo, senpiOne, senpiTwo].map((file) => [file, 0])),
    })
  })
})

test("#given overlapping and incomplete records #when coverage is checked #then all differing paths fail the check", () => {
  withFixture((cwd) => {
    // given
    record(cwd, "root-remainder-1", rootOne)
    record(cwd, "root-remainder-2", [...rootTwo.slice(1), ".dot.test.ts", "ghost.test.ts"])

    // when
    const result = run(cwd, "root")

    // then
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("duplicate: .dot.test.ts\nmissing: d.test.mjs\nunexpected: ghost.test.ts")
  })
})

// Bun on Windows writes record keys with backslashes; part three's two invocations share one artifact.
function windowsSenpiRecords(cwd: string, rest: readonly string[]): void {
  windowsRecord(cwd, "windows-shard-record-senpi-one", "senpi-one", [])
  windowsRecord(cwd, "windows-shard-record-senpi-two", "senpi-two", ["packages\\omo-senpi\\a.test.ts"])
  windowsRecord(cwd, "windows-shard-record-senpi-three", "senpi-three-worker", [])
  windowsRecord(cwd, "windows-shard-record-senpi-three", "senpi-three-rest", rest)
}

test("#given the Windows Senpi parts' records #when they cover the suite exactly #then the check passes", () => {
  withFixture((cwd) => {
    // given
    windowsSenpiRecords(cwd, ["packages\\omo-senpi-extra\\c_test.ts"])

    // when
    const result = run(cwd, "windows-senpi")

    // then
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("windows-senpi: 2 files match discovery exactly (0 + 1 + 0 + 1; no overlap)")
  })
})

test("#given a Windows part that dropped or repeated a file #when coverage is checked #then the check fails", () => {
  withFixture((cwd) => {
    // given
    windowsSenpiRecords(cwd, ["packages/omo-senpi/a.test.ts"])

    // when
    const result = run(cwd, "windows-senpi")

    // then
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("duplicate: packages/omo-senpi/a.test.ts\nmissing: packages/omo-senpi-extra/c_test.ts")
  })
})

test("#given a Windows part whose record never uploaded #when coverage is checked #then the check fails", () => {
  withFixture((cwd) => {
    // given
    windowsRecord(cwd, "windows-shard-record-senpi-two", "senpi-two", ["packages/omo-senpi/a.test.ts", "packages/omo-senpi-extra/c_test.ts"])

    // when
    const result = run(cwd, "windows-senpi")

    // then
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("expected one senpi-one.timings.json")
  })
})

test("#given one absent artifact #when coverage is checked #then it fails even if the remaining artifact covers all files", () => {
  withFixture((cwd) => {
    // given
    record(cwd, "root-remainder-1", [...rootOne, ...rootTwo])

    // when
    const result = run(cwd, "root")

    // then
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("ci-shard-root-remainder-2")
  })
})
