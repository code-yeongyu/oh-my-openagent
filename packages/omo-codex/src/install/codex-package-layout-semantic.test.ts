/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { shouldBuildSourcePackages } from "./codex-package-layout"

describe("Codex installer source package build split", () => {
  test("#given monorepo source checkout without root src #when resolving TS installer build mode #then source packages are built", async () => {
    // given
    const repoRoot = await mkdtemp(join(tmpdir(), "omo-codex-source-layout-"))
    await mkdir(join(repoRoot, "packages", "omo-opencode", "src"), { recursive: true })
    await writeFile(join(repoRoot, "packages", "omo-opencode", "src", "index.ts"), "export {}\n")
    await writeFile(join(repoRoot, "package.json"), JSON.stringify({ name: "oh-my-opencode", version: "4.9.2" }))

    // when
    const buildSource = await shouldBuildSourcePackages(repoRoot)

    // then
    expect(buildSource).toBe(true)
  })

  test("#given packaged lazycodex adapter #when resolving TS installer build mode #then bundled package artifacts are used", async () => {
    // given
    const repoRoot = await mkdtemp(join(tmpdir(), "omo-codex-packaged-layout-"))
    await writeFile(join(repoRoot, "package.json"), JSON.stringify({ name: "lazycodex-ai", version: "4.9.2" }))

    // when
    const buildSource = await shouldBuildSourcePackages(repoRoot)

    // then
    expect(buildSource).toBe(false)
  })
})
