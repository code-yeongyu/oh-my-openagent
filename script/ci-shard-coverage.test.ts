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

function run(cwd: string, mode: "root" | "senpi" | "merge", output?: string) {
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
