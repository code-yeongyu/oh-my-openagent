// Security contract (omo#13440, design v7 section 2, M6): an argv the launcher classifies `local-only` is dispatched
// before the engine trust stage, so the stage reaching one is a dispatch mistake. It refuses with the typed
// `trust-kind-local-only` refusal (the launcher maps every refusal to exit 78) and records it in the diagnostics log,
// and it neither acquires certificates nor execs. The classifier does not return `local-only` until the switch-on
// change, so this file substitutes it for the stage's import of the classifier.
import { afterAll, expect, mock, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as compileArgs from "../compile-args"

mock.module("../compile-args", () => ({ ...compileArgs, trustLaunchKind: () => "local-only" }))
const { runTrustStage } = await import("../trust-stage")

const dirs: string[] = []
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

test("#given a local-only argv #when the trust stage runs #then it refuses with trust-kind-local-only and neither acquires nor execs", async () => {
  // given
  const dir = await mkdtemp(join(tmpdir(), "omo-trust-local-only-"))
  dirs.push(dir)
  const stderr: string[] = []
  const acquire = mock(async () => ({ certificates: [], fallbackReason: null, codes: [] }))
  const exec = mock(async () => {})

  // when
  const result = await runTrustStage({
    args: ["remote", "status"],
    env: { PATH: process.env.PATH ?? "" },
    directory: dir,
    executable: process.execPath,
    argv: [process.execPath],
    loadedExtra: () => [],
    acquire,
    exec,
    stderr: (line) => stderr.push(line),
  })

  // then
  expect(result).toEqual({ action: "refuse", code: "trust-kind-local-only", check: null })
  expect(acquire).not.toHaveBeenCalled()
  expect(exec).not.toHaveBeenCalled()
  expect(stderr.join("")).toContain("omo: trust-kind-local-only;")
  const records = (await readFile(join(dir, "diagnostics.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  expect(records).toEqual([
    expect.objectContaining({ kind: "local-only", action: "refuse", codes: [{ code: "trust-kind-local-only" }] }),
  ])
})
