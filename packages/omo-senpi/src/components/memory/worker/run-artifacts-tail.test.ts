import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readRunTextTail, writeRunTextAtomic } from "./run-artifacts"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("bounded run text artifacts", () => {
  test("#given UTF-8 diagnostics #when each byte boundary is read #then the tail stays valid and within budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "run-text-tail-"))
    roots.push(root)
    const path = join(root, "stderr.log")
    await writeFile(path, "noise:界🙂é\nError:失敗🙂")
    for (let budget = 1; budget <= 32; budget += 1) {
      const tail = await readRunTextTail(path, budget)
      const body = tail.replace(/^\[truncated to last \d+ bytes\]\n/, "")
      expect(Buffer.byteLength(body)).toBeLessThanOrEqual(budget)
      expect(body).not.toContain("\ufffd")
    }
  })

  test("#given invalid stderr bytes #when decoded #then replacement text cannot exceed the byte budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "run-invalid-tail-"))
    roots.push(root)
    const path = join(root, "stderr.log")
    await writeFile(path, Buffer.from([0xff, 0xff, 0xff, 0xff]))
    const tail = await readRunTextTail(path, 2)
    expect(Buffer.byteLength(tail.replace(/^\[truncated to last \d+ bytes\]\n/, ""))).toBeLessThanOrEqual(2)
  })

  test("#given a bounded diagnostic #when written atomically #then its content is retained without temporary siblings", async () => {
    const root = await mkdtemp(join(tmpdir(), "run-atomic-text-"))
    roots.push(root)
    const path = join(root, "stderr.log")
    await writeRunTextAtomic(path, "Error: startup failed\n")
    expect(await readFile(path, "utf8")).toBe("Error: startup failed\n")
    expect(await readdir(root)).toEqual(["stderr.log"])
  })
})
