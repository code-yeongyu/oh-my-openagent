/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateStandaloneParity } from "./generator"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("standalone parity skills", () => {
  test("#given ordered skill roots with a complete skill closure #when generating #then the first matching skill and its support files are copied", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-parity-skills-"))
    roots.push(root)
    const firstRoot = join(root, "first")
    const secondRoot = join(root, "second")
    const outputRoot = join(root, "output")
    await mkdir(join(firstRoot, "deploy", "scripts"), { recursive: true })
    await mkdir(join(secondRoot, "deploy"), { recursive: true })
    await writeFile(join(firstRoot, "deploy", "SKILL.md"), "---\nname: deploy\ndescription: first\n---\nUse scripts/run.sh")
    await writeFile(join(firstRoot, "deploy", "scripts", "run.sh"), "#!/bin/sh\nexit 0\n")
    await writeFile(join(secondRoot, "deploy", "SKILL.md"), "---\nname: deploy\ndescription: second\n---\nsecond")

    // when
    const generated = await generateStandaloneParity({
      outputRoot,
      skillRoots: [firstRoot, secondRoot],
      commandRoots: [],
      instructionPaths: [],
    })

    // then
    expect(generated.manifest.skills).toEqual(["deploy"])
    expect(await readFile(join(outputRoot, "skills", "deploy", "SKILL.md"), "utf8")).toContain("description: first")
    expect(await readFile(join(outputRoot, "skills", "deploy", "scripts", "run.sh"), "utf8")).toBe("#!/bin/sh\nexit 0\n")
  })
})
