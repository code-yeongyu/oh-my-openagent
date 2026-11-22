import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { runMemoryTool, type MemoryToolLock } from "./memory"
import { runMemoryApplyPatch } from "./memory-apply-patch"
import { author, createPatchFixtureHarness, git, rejected } from "./memory-apply-patch.test-support"

const { fixture, cleanup } = createPatchFixtureHarness()
afterEach(cleanup)

for (const command of ["apply_patch", "memory_apply_patch", "str_replace"] as const) {
  test(`${command} checks prior reads inside the lock before changing any target`, async () => {
    const note = "---\ndescription: Seed\n---\noriginal"
    const { repo, dir } = await fixture({ "one.md": note, "two.md": note })
    const expectedVersions = new Map<string, string>()
    for (const name of ["one.md", "two.md"]) {
      const path = join(dir, name)
      expectedVersions.set(
        path,
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      )
    }
    let head: string | null = null
    const lock: MemoryToolLock = async (_domain, operation) => {
      // The prior writer wins precisely while this caller waits for admission.
      await runMemoryTool({
        repo,
        lock: (_domain, apply) => apply(),
        params: {
          command: "insert",
          file_path: "two.md",
          insert_line: 1,
          insert_text: "concurrent",
          author,
          reason: "winner",
        },
      })
      head = await repo.head()
      return operation()
    }
    const input = [
      "*** Begin Patch",
      ...["one.md", "two.md"].flatMap((file) => [`*** Update File: ${file}`, "@@", "-original", "+patched"]),
      "*** End Patch",
    ].join("\n")
    const options = { repo, lock, expectedVersions }
    const error = await rejected(
      command === "memory_apply_patch"
        ? runMemoryApplyPatch({
            ...options,
            params: { author, reason: "patch", input },
          })
        : runMemoryTool({
            ...options,
            params: {
              author,
              reason: "edit",
              command,
              file_path: "two.md",
              old_string: "original",
              new_string: "patched",
              input,
            },
          }),
    )
    expect(error).toMatchObject({
      name: "MemoryStaleReadError",
      filePath: join(dir, "two.md"),
      expected: expectedVersions.get(join(dir, "two.md")),
    })
    expect(await repo.head()).toBe(head)
    expect(await git(dir, ["status", "--porcelain"])).toBe("")
    expect(await readFile(join(dir, "one.md"), "utf8")).toBe(note)
  })
}
