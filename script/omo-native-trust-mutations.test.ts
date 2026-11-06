import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyEdit, MutationPatchError, runMutation, type Mutation } from "./omo-native-trust-mutations"

// A one-file package whose test pins `value`, so the harness verdicts are checked against a real `bun test` run.
let repoRoot = ""
const packageDir = join("packages", "fixture")
const row = (find: string, replace: string): Mutation => ({
  id: "fixture", designRow: "fixture", file: "value.ts", find, replace, test: "test/value.test.ts", testNamePattern: "value is one",
})
beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "omo-trust-mutations-test-"))
  await mkdir(join(repoRoot, packageDir, "test"), { recursive: true })
  await writeFile(join(repoRoot, packageDir, "value.ts"), "export const value = 1\n")
  await writeFile(join(repoRoot, packageDir, "test", "value.test.ts"),
    "import { expect, test } from \"bun:test\"\nimport { value } from \"../value\"\ntest(\"value is one\", () => expect(value).toBe(1))\n")
})
afterAll(async () => {
  if (repoRoot) await rm(repoRoot, { recursive: true, force: true })
})

describe("design 9.7 mutation harness", () => {
  test("#given a find that matches zero or two times #when patching #then it fails instead of running a no-op", async () => {
    expect(() => applyEdit("export const value = 1\n", { find: "= 2", replace: "= 3" }, "zero")).toThrow(MutationPatchError)
    expect(() => applyEdit("a = 1; b = 1\n", { find: "= 1", replace: "= 2" }, "two")).toThrow(MutationPatchError)
    await expect(runMutation(row("= 2", "= 3"), { repoRoot, packageDir })).rejects.toThrow(MutationPatchError)
  })

  test("#given a mutation equal to its find #when run #then the control is green and it is reported survived", async () => {
    expect(await runMutation(row("= 1", "= 1"), { repoRoot, packageDir })).toMatchObject({ verdict: "survived", failing: 0 })
  }, 60_000)

  test("#given a mutation the named test catches #when run #then it is killed and the real file is unchanged", async () => {
    expect(await runMutation(row("= 1", "= 2"), { repoRoot, packageDir })).toMatchObject({ verdict: "killed", failing: 1 })
    expect(await readFile(join(repoRoot, packageDir, "value.ts"), "utf8")).toBe("export const value = 1\n")
  }, 60_000)
})
