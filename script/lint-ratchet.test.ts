import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { beforeAll, expect, it } from "bun:test"

import {
  compare,
  countByFile,
  countsTowardRatchet,
  countSuppressions,
  lint,
  ratchetedFiles,
  SUPPRESSION,
} from "./lint-ratchet.ts"

const root = "/repo"

it("counts findings per file and rule, relative to the repo root", () => {
  const counts = countByFile(
    [
      { code: "typescript(no-non-null-assertion)", filename: "packages/omo-opencode/src/a.ts" },
      { code: "typescript(no-non-null-assertion)", filename: "/repo/packages/omo-opencode/src/a.ts" },
      { code: "typescript(no-explicit-any)", filename: "packages/omo-opencode/src/a.ts" },
      { code: "typescript(ban-ts-comment)", filename: "script/b.ts" },
    ],
    root,
  )
  expect(counts).toEqual({
    "packages/omo-opencode/src/a.ts": { "typescript/no-non-null-assertion": 2, "typescript/no-explicit-any": 1 },
    "script/b.ts": { "typescript/ban-ts-comment": 1 },
  })
})

it("refuses a count that goes up, including any finding in a file the baseline does not list", () => {
  const { increases } = compare(
    { "packages/omo-opencode/src/a.ts": { "typescript/no-non-null-assertion": 2 } },
    {
      "packages/omo-opencode/src/a.ts": { "typescript/no-non-null-assertion": 3 },
      "packages/omo-opencode/src/new.ts": { "typescript/no-explicit-any": 1 },
    },
  )
  expect(increases).toEqual([
    { file: "packages/omo-opencode/src/a.ts", rule: "typescript/no-non-null-assertion", before: 2, after: 3 },
    { file: "packages/omo-opencode/src/new.ts", rule: "typescript/no-explicit-any", before: 0, after: 1 },
  ])
})

it("reports a count that goes down, so the baseline must be lowered in the same change", () => {
  const { increases, decreases } = compare(
    {
      "packages/omo-opencode/src/a.ts": { "typescript/no-non-null-assertion": 2 },
      "packages/omo-opencode/src/gone.ts": { "typescript/no-explicit-any": 1 },
    },
    { "packages/omo-opencode/src/a.ts": { "typescript/no-non-null-assertion": 2 } },
  )
  expect(increases).toEqual([])
  expect(decreases).toEqual([
    { file: "packages/omo-opencode/src/gone.ts", rule: "typescript/no-explicit-any", before: 1, after: 0 },
  ])
})

it("accepts counts that match the baseline exactly", () => {
  const counts = { "packages/omo-opencode/src/a.ts": { "typescript/no-non-null-assertion": 2 } }
  expect(compare(counts, counts)).toEqual({ increases: [], decreases: [] })
})

it("counts every disable comment that could hide one of the ratcheted rules, in both linters' forms", () => {
  // Built at runtime so this file holds no directive of its own for the gate to count.
  const line = "/".repeat(2)
  const block = ["/", "*"].join("")
  const source = [
    `${line} oxlint-disable-next-line typescript/no-explicit-any`,
    `${line} eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- legacy`,
    `${block} eslint-disable */`,
    `const a = 1; ${line} oxlint-disable-line`,
    `${line} oxlint-disable-next-line typescript/ban-ts-comment, eslint/no-console`,
    `${line} oxlint-disable-next-line eslint/no-console -- unrelated rule, not counted`,
    `const text = "oxlint-disable-next-line typescript/no-explicit-any";`,
    `${block}\n  eslint-disable-next-line typescript/no-explicit-any\n*/`,
  ].join("\n")
  expect(countSuppressions("probe.ts", source)).toBe(6)
  expect(countSuppressions("probe.ts", "const x = 1;\n")).toBe(0)
})

it("refuses a new disable comment like any other rise", () => {
  const { increases } = compare({}, { "script/probe.ts": { [SUPPRESSION]: 1 } })
  expect(increases).toEqual([{ file: "script/probe.ts", rule: SUPPRESSION, before: 0, after: 1 }])
})

it("counts a disable comment that names one of the omo-testing rules", () => {
  // Built at runtime so this file holds no directive of its own for the gate to count.
  const line = "/".repeat(2)
  const source = [
    `${line} oxlint-disable-next-line omo-testing/no-fixed-sleep`,
    `${line} eslint-disable-next-line omo-testing/no-flake-masking -- unrelated rule, not counted`,
    `${line} oxlint-disable-next-line omo-testing/no-module-mock`,
    `${line} oxlint-disable-next-line eslint/no-console`,
  ].join("\n")
  expect(countSuppressions("probe.ts", source)).toBe(3)
})

it("skips generated sources by path, so only hand-written files are ratcheted", () => {
  expect(
    ratchetedFiles([
      "packages/telemetry-core/src/otlp-proto/opentelemetry/proto/common/v1/common_pb.ts",
      "packages/senpi-desktop-protocol/src/engine-schema.generated.ts",
      "packages/telemetry-core/src/otlp-proto/handwritten.ts",
      "packages/web/lib/pb.ts",
      "README.md",
    ]),
  ).toEqual(["packages/telemetry-core/src/otlp-proto/handwritten.ts", "packages/web/lib/pb.ts"])
})

// #14220: minified bundle output is not a test source, but the bundler's short function names collide
// with the test API names the two omo-testing rules key on, so the ratchet drops bundle paths for
// them at counting time. The predicate is the contract: bundle output never counts for omo-testing;
// everything else counts everywhere, on either path separator.
it("never counts the omo-testing rules for minified bundle output", () => {
  expect(
    countsTowardRatchet("omo-testing/no-flake-masking", "packages/omo-senpi/plugin/extensions/omo-thread-client.js"),
  ).toBe(false)
  expect(
    countsTowardRatchet("omo-testing/no-fixed-sleep", "packages/omo-senpi/plugin/runtime/rollback-migrate.js"),
  ).toBe(false)
  const windowsPath = ["packages", "omo-senpi", "plugin", "extensions", "bundle.js"].join(String.fromCharCode(92))
  expect(countsTowardRatchet("omo-testing/no-flake-masking", windowsPath)).toBe(false)
  expect(countsTowardRatchet("omo-testing(no-flake-masking)", "packages/omo-senpi/plugin/extensions/bundle.js")).toBe(
    false,
  )
})

it("still counts the omo-testing rules in real test files, and every other rule everywhere", () => {
  expect(countsTowardRatchet("omo-testing/no-flake-masking", "packages/omo-senpi/src/x.test.ts")).toBe(true)
  expect(countsTowardRatchet("omo-testing/no-fixed-sleep", "packages/omo-native/test/x.test.ts")).toBe(true)
  expect(countsTowardRatchet("typescript/no-explicit-any", "packages/omo-senpi/plugin/extensions/omo.js")).toBe(true)
  expect(countsTowardRatchet("typescript/no-non-null-assertion", "packages/omo-senpi/plugin/runtime/sdk.js")).toBe(true)
})

// The ratchet's own lint run in a scratch git repo that reuses this repo's oxlint and plugin, with a
// violating test beside a copy of the ratchet config (a config's ignorePatterns resolve in its own
// directory). Listed in .eslintignore, the test is still counted; hidden by the config's
// ignorePatterns, which --no-ignore does not reach, it is reported as skipped instead of as zero.
let listedInEslintignore: ReturnType<typeof lint> | undefined
let hiddenByIgnorePatterns: ReturnType<typeof lint> | undefined
beforeAll(() => {
  const repo = join(import.meta.dir, "..")
  const scratch = mkdtempSync(join(tmpdir(), "omo-lint-ratchet-ignore-"))
  try {
    const config = join(scratch, "script/lint-ratchet.oxlintrc.json")
    const shipped = JSON.parse(readFileSync(join(repo, "script/lint-ratchet.oxlintrc.json"), "utf8"))
    mkdirSync(dirname(config), { recursive: true })
    for (const entry of ["node_modules", "script/oxlint"]) symlinkSync(join(repo, entry), join(scratch, entry))
    writeFileSync(config, JSON.stringify(shipped))
    writeFileSync(
      join(scratch, "script/hidden.test.ts"),
      'import { mock } from "bun:test";\nmock.module("./dep", () => ({}));\n',
    )
    writeFileSync(join(scratch, "clean.ts"), "export const clean = 1;\n")
    writeFileSync(join(scratch, ".eslintignore"), "script/hidden.test.ts\n")
    for (const args of [
      ["init", "-q"],
      ["add", "--", "."],
    ])
      expect(spawnSync("git", args, { cwd: scratch }).status).toBe(0)
    listedInEslintignore = lint(scratch)
    writeFileSync(config, JSON.stringify({ ...shipped, ignorePatterns: ["hidden.test.ts"] }))
    hiddenByIgnorePatterns = lint(scratch)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}, 60_000)

it("still counts a violating file that .eslintignore lists", () => {
  expect(listedInEslintignore).toEqual({
    counts: { "script/hidden.test.ts": { "omo-testing/no-module-mock": 1 } },
    unparsed: [],
    skipped: 0,
  })
})

it("reports a file hidden by the ratchet config's ignorePatterns as skipped, not as zero findings", () => {
  expect(hiddenByIgnorePatterns).toEqual({ counts: {}, unparsed: [], skipped: 1 })
})
