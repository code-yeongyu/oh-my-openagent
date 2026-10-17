/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findMissingSpawnedScripts } from "./spawned-script-targets"

const nodeExecutable = "/usr/bin/node"

describe("spawned script targets", () => {
  test("#given a node invocation naming a repo script that is gone #when targets are checked #then that path is reported", async () => {
    // given
    const repoRoot = await mkdtemp(join(tmpdir(), "omo-spawned-targets-"))
    const missingScript = join(repoRoot, "scripts", "gone.mjs")

    // when
    const missing = await findMissingSpawnedScripts({
      invocations: [{ command: nodeExecutable, args: [missingScript, "--seed"] }],
      repoRoot,
      nodeExecutable,
    })

    // then
    expect(missing).toEqual([missingScript])
  })

  test("#given a node invocation naming a script that exists #when targets are checked #then nothing is reported", async () => {
    // given
    const repoRoot = await mkdtemp(join(tmpdir(), "omo-spawned-targets-"))
    const presentScript = join(repoRoot, "present.mjs")
    await writeFile(presentScript, "export {}\n")

    // when
    const missing = await findMissingSpawnedScripts({
      invocations: [{ command: nodeExecutable, args: [presentScript] }],
      repoRoot,
      nodeExecutable,
    })

    // then
    expect(missing).toEqual([])
  })

  test("#given non-script invocations and paths outside the repo #when targets are checked #then none are reported", async () => {
    // given
    const repoRoot = await mkdtemp(join(tmpdir(), "omo-spawned-targets-"))
    const outsideScript = join(tmpdir(), "omo-outside-absent.mjs")

    // when
    const missing = await findMissingSpawnedScripts({
      invocations: [
        { command: "npm", args: ["ci", "--omit=dev"] },
        { command: "git", args: ["status"] },
        { command: nodeExecutable, args: ["--version"] },
        { command: nodeExecutable, args: [outsideScript] },
        { command: nodeExecutable, args: [join(repoRoot, "relative-only")] },
      ],
      repoRoot,
      nodeExecutable,
    })

    // then
    expect(missing).toEqual([])
  })
})
