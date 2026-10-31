import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MutationError, runMutation } from "./mutation-proof"

let root = ""
const OWNER = "export const add = (a: number, b: number): number => a + b\n"

describe("#given a production owner and a test that exercises it", () => {
  beforeAll(() => {
    root = mkdtempSync(join(process.env.RUN_TMP ?? tmpdir(), "mutation-proof-"))
    writeFileSync(join(root, "owner.ts"), OWNER)
    writeFileSync(
      join(root, "owner.test.ts"),
      'import { expect, test } from "bun:test"\nimport { add } from "./owner"\ntest("adds", () => { expect(add(1, 2)).toBe(3) })\n',
    )
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  test("#when the owner is broken #then the test goes red and the owner is restored byte for byte", async () => {
    const result = await runMutation({
      cwd: root,
      file: "owner.ts",
      find: "a + b",
      replace: "a - b",
      tests: [{ label: "candidate", command: [process.execPath, "test", "owner.test.ts"] }],
    })
    expect(result.outcomes.map((outcome) => [outcome.label, outcome.verdict])).toEqual([["candidate", "red"]])
    expect(result.restoredSha256).toBe(result.originalSha256)
    expect(readFileSync(join(root, "owner.ts"), "utf8")).toBe(OWNER)
  })

  test("#when the find text is not unique or empty #then it refuses before touching the file", async () => {
    for (const [find, kind] of [["a", "FIND_NOT_UNIQUE"], ["", "FIND_EMPTY"]] as const) {
      const attempt = runMutation({ cwd: root, file: "owner.ts", find, replace: "x", tests: [] })
      await expect(attempt).rejects.toMatchObject({ kind })
    }
    expect(readFileSync(join(root, "owner.ts"), "utf8")).toBe(OWNER)
  })
})
