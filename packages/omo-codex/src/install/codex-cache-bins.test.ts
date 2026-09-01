/// <reference types="bun-types" />

import { describe, expect, it, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { chmod, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
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
  it("#given posix platform #when writing the canonical runtime wrapper #then uses the new name, marker, and edition exports", async () => {
    // given
    const fixture = await createRepoFixture()

    // when
    const link = await linkRootRuntimeBin({ ...fixture, platform: "linux" })

    // then
    expect(link).not.toBeNull()
    expect(link?.name).toBe("omo-agent-toolkit")
    expect(link?.path).toBe(join(fixture.binDir, "omo-agent-toolkit"))
    const wrapper = await readFile(link?.path ?? "", "utf8")
    expect(wrapper).toContain("OMO_GENERATED_RUNTIME_WRAPPER")
    expect(wrapper).toContain("export OMO_INVOCATION_NAME=omo-agent-toolkit")
    expect(wrapper).toContain("export OMO_EDITION=codex")
    await expect(lstat(join(fixture.binDir, "omo"))).rejects.toThrow()
  })

  it("#given a marker-bearing legacy omo wrapper #when writing the canonical wrapper #then deletes the legacy wrapper", async () => {
    // given
    const fixture = await createRepoFixture()
    await mkdir(fixture.binDir, { recursive: true })
    await writeFile(join(fixture.binDir, "omo"), "#!/bin/sh\n# OMO_GENERATED_RUNTIME_WRAPPER\n")

    // when
    await linkRootRuntimeBin({ ...fixture, platform: "linux" })

    // then
    await expect(lstat(join(fixture.binDir, "omo"))).rejects.toThrow()
    expect(await readFile(join(fixture.binDir, "omo-agent-toolkit"), "utf8")).toContain("OMO_GENERATED_RUNTIME_WRAPPER")
  })

  it("#given an unmarked user-owned omo #when writing the canonical wrapper twice #then preserves omo byte-identical and remains idempotent", async () => {
    // given
    const fixture = await createRepoFixture()
    const legacyPath = join(fixture.binDir, "omo")
    const canonicalPath = join(fixture.binDir, "omo-agent-toolkit")
    const userContent = Buffer.from("#!/bin/sh\nprintf 'user-owned omo\\n'\n")
    await mkdir(fixture.binDir, { recursive: true })
    await writeFile(legacyPath, userContent)

    // when
    await linkRootRuntimeBin({ ...fixture, platform: "linux" })
    const firstCanonical = await readFile(canonicalPath)
    await linkRootRuntimeBin({ ...fixture, platform: "linux" })

    // then
    expect(await readFile(legacyPath)).toEqual(userContent)
    expect(await readFile(canonicalPath)).toEqual(firstCanonical)
  })

  it("#given win32 platform #when writing the canonical runtime wrapper #then uses the new name and environment exports", async () => {
    // given
    const fixture = await createRepoFixture()

    // when
    const link = await linkRootRuntimeBin({ ...fixture, platform: "win32" })

    // then
    expect(link?.name).toBe("omo-agent-toolkit")
    expect(link?.path).toBe(join(fixture.binDir, "omo-agent-toolkit.cmd"))
    const wrapper = await readFile(link?.path ?? "", "utf8")
    expect(wrapper).toContain("rem OMO_GENERATED_RUNTIME_WRAPPER")
    expect(wrapper).toContain('set "OMO_INVOCATION_NAME=omo-agent-toolkit"')
    expect(wrapper).toContain('set "OMO_EDITION=codex"')
    await expect(lstat(join(fixture.binDir, "omo.cmd"))).rejects.toThrow()
  })

  it("#given posix platform #when writing the omo-agent-toolkit runtime wrapper #then embeds the node fallback chain", async () => {
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

  it("#given win32 platform #when writing the omo runtime wrapper #then discovers Codex bundled Node from config before bare node", async () => {
    // given
    const fixture = await createRepoFixture()

    // when
    const link = await linkRootRuntimeBin({ ...fixture, platform: "win32" })

    // then
    expect(link).not.toBeNull()
    const wrapper = await readFile(link?.path ?? "", "utf8")
    expect(wrapper).toContain('for /f "tokens=1,* delims==" %%A in (\'findstr /R /C:"NODE_REPL_NODE_PATH[ ]*=" "%CODEX_HOME%\\config.toml" 2^>nul\') do (')
    expect(wrapper).toContain('if "!OMO_NODE_BINARY:~0,1!"=="^"" set "OMO_NODE_BINARY=!OMO_NODE_BINARY:~1!"')
    expect(wrapper).toContain(`if "!OMO_NODE_BINARY:~0,1!"=="'" set "OMO_NODE_BINARY=!OMO_NODE_BINARY:~1!"`)
    expect(wrapper).toContain('if "%OMO_RUNTIME%"=="node" if defined OMO_NODE_BINARY if exist "')
    expect(wrapper.indexOf("NODE_REPL_NODE_PATH")).toBeLessThan(wrapper.indexOf('if "%OMO_RUNTIME%"=="node"'))
    expect(wrapper).toContain('"%OMO_NODE_BINARY%" "')
    expect(wrapper).not.toContain('  node "')
  })

  const posixOnly = process.platform === "win32" ? test.skip : test
  posixOnly("#given posix wrapper target was removed #when running omo #then exits with reinstall guidance", async () => {
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
    expect(stderr).toContain(`omo-agent-toolkit: runtime target missing at ${join(fixture.repoRoot, "dist", "cli", "index.js")}`)
    expect(stderr).toContain("reinstall with: npx --yes lazycodex-ai@latest install --no-tui")
  })

  posixOnly("#given ulw-loop command #when running omo wrapper #then preserves the ulw-loop token", async () => {
    // given
    const fixture = await createRepoFixture()
    const link = await linkRootRuntimeBin({ ...fixture, platform: "linux" })
    if (link === null) throw new Error("expected runtime wrapper link")
    await chmod(link.path, 0o755)
    await mkdir(fixture.binDir, { recursive: true })
    const ulwLoopBin = join(fixture.binDir, "omo-ulw-loop")
    await writeFile(ulwLoopBin, "#!/bin/sh\nprintf '%s\\n' \"$*\"\n")
    await chmod(ulwLoopBin, 0o755)

    // when
    const process = Bun.spawn([link.path, "ulw-loop", "help"], { env: { ...Bun.env }, stderr: "pipe", stdout: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])

    // then
    expect(exitCode).toBe(0)
    expect(stderr).toBe("")
    expect(stdout.trim()).toBe("ulw-loop help")
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

  it("#given win32 ulw-loop command #when writing omo.cmd #then preserves the ulw-loop token", async () => {
    // given
    const fixture = await createRepoFixture()

    // when
    const link = await linkRootRuntimeBin({ ...fixture, platform: "win32" })

    // then
    if (link === null) throw new Error("expected runtime wrapper link")
    const wrapper = await readFile(link.path, "utf8")
    expect(wrapper).toMatch(/"[^"\r\n]*omo-ulw-loop\.cmd" ulw-loop %\*/)
  })
})

describe("legacy omo reclamation across link kinds", () => {
  it("#given bin/omo is a symlink resolving to a marker-bearing wrapper #when writing the canonical wrapper #then removes the symlink and keeps its target", async () => {
    // given
    const fixture = await createRepoFixture()
    await mkdir(fixture.binDir, { recursive: true })
    const target = join(fixture.repoRoot, "generated-wrapper.sh")
    await writeFile(target, "#!/bin/sh\n# OMO_GENERATED_RUNTIME_WRAPPER\necho stale\n")
    await symlink(target, join(fixture.binDir, "omo"))

    // when
    await linkRootRuntimeBin({ ...fixture, platform: "linux" })

    // then
    await expect(lstat(join(fixture.binDir, "omo"))).rejects.toThrow()
    expect(await readFile(target, "utf8")).toContain("OMO_GENERATED_RUNTIME_WRAPPER")
  })

  it("#given bin/omo is a symlink to an unmarked user file #when writing the canonical wrapper #then preserves the symlink", async () => {
    // given
    const fixture = await createRepoFixture()
    await mkdir(fixture.binDir, { recursive: true })
    const target = join(fixture.repoRoot, "my-own-script.sh")
    await writeFile(target, "#!/bin/sh\necho mine\n")
    await symlink(target, join(fixture.binDir, "omo"))

    // when
    await linkRootRuntimeBin({ ...fixture, platform: "linux" })

    // then
    const entry = await lstat(join(fixture.binDir, "omo"))
    expect(entry.isSymbolicLink()).toBe(true)
  })

  it("#given bin/omo is a dangling symlink #when writing the canonical wrapper #then completes without throwing", async () => {
    // given
    const fixture = await createRepoFixture()
    await mkdir(fixture.binDir, { recursive: true })
    await symlink(join(fixture.repoRoot, "missing-target.sh"), join(fixture.binDir, "omo"))

    // when
    const link = await linkRootRuntimeBin({ ...fixture, platform: "linux" })

    // then
    expect(link?.name).toBe("omo-agent-toolkit")
  })
})
