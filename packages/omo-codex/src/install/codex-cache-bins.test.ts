/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { linkRootRuntimeBin } from "./codex-cache-bins"

async function createRepoFixture(): Promise<{ repoRoot: string; binDir: string; codexHome: string }> {
  const root = mkdtempSync(join(tmpdir(), "omo-codex-cache-bins-"))
  const repoRoot = join(root, "repo")
  await mkdir(join(repoRoot, "dist", "cli"), { recursive: true })
  await writeFile(join(repoRoot, "dist", "cli", "index.js"), "")
  return { repoRoot, binDir: join(root, "bin"), codexHome: join(root, "codex") }
}

describe("linkRootRuntimeBin runtime wrapper parity", () => {
  it("#given posix platform #when writing the omo runtime wrapper #then embeds the node fallback chain", async () => {
    // given
    const fixture = await createRepoFixture()

    // when
    const link = await linkRootRuntimeBin({ ...fixture, platform: "linux" })

    // then
    expect(link).not.toBeNull()
    const wrapper = await readFile(link?.path ?? "", "utf8")
    expect(wrapper).toContain("OMO_RUNTIME")
    expect(wrapper).toMatch(/dist[\\/]cli-node[\\/]index\.js/)
    expect(wrapper).toContain("exec node")
    expect(wrapper.indexOf("OMO_RUNTIME")).toBeLessThan(wrapper.indexOf("command -v bun"))
  })

  it("#given posix platform #when bun is absent everywhere #then the wrapper falls back to node before exiting 127", async () => {
    // given
    const fixture = await createRepoFixture()

    // when
    const link = await linkRootRuntimeBin({ ...fixture, platform: "linux" })

    // then
    const wrapper = await readFile(link?.path ?? "", "utf8")
    const bunMissingBranch = wrapper.slice(wrapper.lastIndexOf('if [ -z "$BUN_BINARY" ]'))
    expect(bunMissingBranch).toContain("exec node")
    expect(bunMissingBranch).toContain("OMO_RUNTIME=node")
    expect(bunMissingBranch).toContain("exit 127")
  })

  it("#given win32 platform #when writing the omo runtime wrapper #then embeds the node fallback chain", async () => {
    // given
    const fixture = await createRepoFixture()

    // when
    const link = await linkRootRuntimeBin({ ...fixture, platform: "win32" })

    // then
    expect(link).not.toBeNull()
    const wrapper = await readFile(link?.path ?? "", "utf8")
    expect(wrapper).toContain("OMO_RUNTIME")
    expect(wrapper).toMatch(/dist[\\/]cli-node[\\/]index\.js/)
    expect(wrapper.indexOf("OMO_RUNTIME")).toBeLessThan(wrapper.indexOf("where bun"))
    expect(wrapper).toContain("exit /b 127")
  })

  it("#given posix wrapper target was removed #when running omo #then exits with reinstall guidance", async () => {
    // given
    const fixture = await createRepoFixture()
    const link = await linkRootRuntimeBin({ ...fixture, platform: "linux" })
    if (link === null) throw new Error("expected runtime wrapper link")
    await chmod(link.path, 0o755)
    await rm(join(fixture.repoRoot, "dist", "cli", "index.js"))

    // when
    const process = Bun.spawn([link.path], { env: { ...Bun.env, BUN_BINARY: "bun" }, stderr: "pipe", stdout: "pipe" })
    const [stderr, exitCode] = await Promise.all([new Response(process.stderr).text(), process.exited])

    // then
    expect(exitCode).toBe(1)
    expect(stderr).toContain(`omo: runtime target missing at ${join(fixture.repoRoot, "dist", "cli", "index.js")}`)
    expect(stderr).toContain("reinstall with: npx --yes lazycodex-ai@latest install --no-tui")
  })

  it("#given win32 wrapper target was removed #when writing omo.cmd #then it contains reinstall guidance before bun exec", async () => {
    // given
    const fixture = await createRepoFixture()

    // when
    const link = await linkRootRuntimeBin({ ...fixture, platform: "win32" })

    // then
    if (link === null) throw new Error("expected runtime wrapper link")
    const wrapper = await readFile(link.path, "utf8")
    const guardIndex = wrapper.indexOf("runtime target missing")
    expect(guardIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(wrapper.indexOf('"%BUN_BINARY%"'))
    expect(wrapper).toContain("reinstall with: npx --yes lazycodex-ai@latest install --no-tui")
  })
})
