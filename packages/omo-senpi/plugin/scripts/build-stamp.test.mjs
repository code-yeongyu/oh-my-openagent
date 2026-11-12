import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BUILD_STAMP_FILE, readCheckoutHead, staleBuildWarning, writeBuildStamp } from "./build-stamp.mjs"

// #13232: a local install runs the checkout's plugin build. The build records the commit it was made from, and the
// launcher warns once when a plugin build input changed since then. These tests use real git repositories.
const PLUGIN = "packages/omo-senpi/plugin"
const INPUTS = "packages/omo-senpi/bundle-inputs.json"
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout.trim()
}

function write(root, path, content) {
  mkdirSync(join(root, path, ".."), { recursive: true })
  writeFileSync(join(root, path), content)
}

function commitAll(root, message) {
  git(root, "add", "-A")
  git(root, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", message)
  return git(root, "rev-parse", "HEAD")
}

// A checkout whose input map names one source file and one directory, with a built plugin.
function makeCheckout() {
  const root = mkdtempSync(join(tmpdir(), "omo-build-stamp-"))
  roots.push(root)
  git(root, "init", "-q", "-b", "dev")
  write(root, ".gitignore", `/${PLUGIN}/extensions/\n/${PLUGIN}/${BUILD_STAMP_FILE}\n`)
  write(root, "packages/omo-senpi/src/index.ts", "export const a = 1\n")
  write(root, "packages/omo-codex/src/install/run.ts", "export const b = 1\n")
  write(root, "docs/notes.md", "notes\n")
  write(
    root,
    INPUTS,
    `${JSON.stringify({ version: 1, files: ["packages/omo-senpi/src/index.ts"], directories: ["packages/omo-codex/src/install"] })}\n`,
  )
  commitAll(root, "base")
  write(root, `${PLUGIN}/extensions/omo.js`, "// built\n")
  return { root, plugin: join(root, PLUGIN) }
}

describe("build stamp", () => {
  test("#given an in-tree build #when the stamp is written #then it records the checkout commit", () => {
    // given
    const { root, plugin } = makeCheckout()

    // when
    const written = writeBuildStamp(plugin, {})

    // then
    expect(written).toBe(true)
    expect(JSON.parse(readFileSync(join(plugin, BUILD_STAMP_FILE), "utf8"))).toEqual({
      version: 1,
      commit: git(root, "rev-parse", "HEAD"),
    })
  })

  test("#given a build into an output override #when the stamp step runs #then no stamp is written", () => {
    // given
    const { plugin } = makeCheckout()

    // when
    const written = writeBuildStamp(plugin, { OMO_SENPI_PLUGIN_OUTPUT: "/tmp/staged-plugin" })

    // then
    expect(written).toBe(false)
    expect(existsSync(join(plugin, BUILD_STAMP_FILE))).toBe(false)
  })

  test("#given a build stamped before a plugin input changed #when checked #then it warns naming the build command", () => {
    // given
    const { root, plugin } = makeCheckout()
    writeBuildStamp(plugin, {})
    write(root, "packages/omo-senpi/src/index.ts", "export const a = 2\n")
    commitAll(root, "change an input")

    // when
    const warning = staleBuildWarning(plugin)

    // then
    expect(warning).toContain("bun run build:senpi-plugin")
    expect(warning).toContain(plugin)
    expect(warning?.includes("\n")).toBe(false)
  })

  test("#given a build stamped at the checkout's commit #when checked #then it is silent", () => {
    // given
    const { plugin } = makeCheckout()
    writeBuildStamp(plugin, {})

    // when
    const warning = staleBuildWarning(plugin)

    // then
    expect(warning).toBeUndefined()
  })

  test("#given a later commit that touches no plugin input #when checked #then it is silent", () => {
    // given
    const { root, plugin } = makeCheckout()
    writeBuildStamp(plugin, {})
    write(root, "docs/notes.md", "more notes\n")
    commitAll(root, "unrelated")

    // when
    const warning = staleBuildWarning(plugin)

    // then
    expect(warning).toBeUndefined()
  })

  test("#given a later commit under an input directory #when checked #then it warns", () => {
    // given
    const { root, plugin } = makeCheckout()
    writeBuildStamp(plugin, {})
    write(root, "packages/omo-codex/src/install/run.ts", "export const b = 2\n")
    commitAll(root, "change a file in an input directory")

    // when
    const warning = staleBuildWarning(plugin)

    // then
    expect(warning).toContain("bun run build:senpi-plugin")
  })

  // The map changes only when the input set does: a file that left the set is no longer on HEAD's list.
  test("#given a later commit that changes only the input map #when checked #then it warns", () => {
    // given
    const { root, plugin } = makeCheckout()
    writeBuildStamp(plugin, {})
    write(root, INPUTS, `${JSON.stringify({ version: 1, files: [], directories: [] })}\n`)
    commitAll(root, "an input left the set")

    // when
    const warning = staleBuildWarning(plugin)

    // then
    expect(warning).toContain("bun run build:senpi-plugin")
  })

  test("#given a built plugin with no stamp #when checked #then it is silent", () => {
    // given
    const { plugin } = makeCheckout()

    // when
    const warning = staleBuildWarning(plugin)

    // then
    expect(warning).toBeUndefined()
  })

  test("#given a plugin outside any checkout, as a packed install has it #when checked #then it is silent", () => {
    // given
    const plugin = mkdtempSync(join(tmpdir(), "omo-packed-plugin-"))
    roots.push(plugin)
    write(plugin, "extensions/omo.js", "// built\n")
    write(plugin, BUILD_STAMP_FILE, `${JSON.stringify({ version: 1, commit: "a".repeat(40) })}\n`)

    // when
    const warning = staleBuildWarning(plugin)

    // then
    expect(warning).toBeUndefined()
  })

  // reftable ref storage keeps HEAD as a placeholder and its refs in binary tables; the fs reader must not guess.
  test("#given a checkout whose HEAD the reader cannot resolve #when checked #then it is silent", () => {
    // given
    const { root, plugin } = makeCheckout()
    writeBuildStamp(plugin, {})
    write(root, "packages/omo-senpi/src/index.ts", "export const a = 3\n")
    commitAll(root, "change an input")
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/.invalid\n")
    mkdirSync(join(root, ".git", "reftable"))

    // when
    const head = readCheckoutHead(root)
    const warning = staleBuildWarning(plugin)

    // then
    expect(head).toBeUndefined()
    expect(warning).toBeUndefined()
  })

  test("#given a branch whose ref lives only in packed-refs #when the head is read #then it resolves without git", () => {
    // given
    const { root } = makeCheckout()
    const commit = git(root, "rev-parse", "HEAD")
    git(root, "pack-refs", "--all")

    // when
    const head = readCheckoutHead(root)

    // then
    expect(existsSync(join(root, ".git", "refs", "heads", "dev"))).toBe(false)
    expect(head).toBe(commit)
  })

  test("#given a linked worktree #when the head is read #then it resolves that worktree's commit", () => {
    // given
    const { root } = makeCheckout()
    write(root, "docs/notes.md", "other\n")
    const other = commitAll(root, "other")
    git(root, "branch", "side", "HEAD~1")
    const worktree = join(root, "..", `${root.split("/").at(-1)}-wt`)
    roots.push(worktree)
    git(root, "worktree", "add", "-q", worktree, "side")

    // when
    const head = readCheckoutHead(worktree)

    // then
    expect(head).toBe(git(worktree, "rev-parse", "HEAD"))
    expect(head).not.toBe(other)
  })
})
