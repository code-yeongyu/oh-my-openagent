import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { homeRelativePath, locateReflectionChildLog } from "./child-log"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function reflectionDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reflection-child-log-"))
  roots.push(root)
  return root
}

describe("locateReflectionChildLog", () => {
  test("#given a run directory with a stderr log #when it is located #then the absolute path is present", async () => {
    // given
    const dir = await reflectionDir()
    await mkdir(join(dir, "runs", "r1"), { recursive: true })
    await writeFile(join(dir, "runs", "r1", "child-stderr.log"), "boom\n")

    // when
    const located = await locateReflectionChildLog(dir, "r1")

    // then
    expect(located).toEqual({ path: join(dir, "runs", "r1", "child-stderr.log"), present: true })
  })

  test("#given a pruned run directory #when it is located #then the path is reported absent", async () => {
    // given
    const dir = await reflectionDir()

    // when
    const located = await locateReflectionChildLog(dir, "r1")

    // then
    expect(located).toEqual({ path: join(dir, "runs", "r1", "child-stderr.log"), present: false })
  })

  test("#given no usable run id #when it is located #then nothing is guessed", async () => {
    // given
    const dir = await reflectionDir()

    // then
    for (const runId of [undefined, "", "  ", "..", "../r1", "a/b"]) {
      expect(await locateReflectionChildLog(dir, runId)).toBeUndefined()
    }
  })
})

describe("homeRelativePath", () => {
  test("#given a path under home #when it is shortened #then home becomes ~", () => {
    expect(homeRelativePath("/Users/me/.omo/memory/agents/a/runtime/reflection/runs/r1/child-stderr.log", "/Users/me"))
      .toBe("~/.omo/memory/agents/a/runtime/reflection/runs/r1/child-stderr.log")
  })

  test("#given a path outside home or a sibling prefix #when it is shortened #then it is unchanged", () => {
    expect(homeRelativePath("/tmp/x/child-stderr.log", "/Users/me")).toBe("/tmp/x/child-stderr.log")
    expect(homeRelativePath("/Users/meow/child-stderr.log", "/Users/me")).toBe("/Users/meow/child-stderr.log")
  })
})
