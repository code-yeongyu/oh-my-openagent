import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import {
  composeKnipConfig,
  FRAGMENT_FILE,
  fragmentDirs,
  isObject,
  KnipConfigError,
  PATH_KEYS,
  readJsonc,
} from "./knip-config.ts"

const REPO_ROOT = join(import.meta.dir, "..")

const withTree = <T>(files: Record<string, unknown>, use: (root: string) => T): T => {
  const root = mkdtempSync(join(tmpdir(), "knip-config-"))
  try {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), typeof content === "string" ? content : JSON.stringify(content))
    }
    return use(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const base = { rules: { types: "off" }, preprocessorOptions: { nextRouteSegmentExports: { dir: "web" } } }

const composeError = (files: Record<string, unknown>): string =>
  withTree({ "knip.base.jsonc": base, ...files }, (root) => {
    try {
      composeKnipConfig(root)
    } catch (error) {
      if (error instanceof KnipConfigError) return error.message
      throw error
    }
    throw new Error("composeKnipConfig accepted an invalid layout")
  })

describe("knip config composed from per-directory fragments", () => {
  test("fragments of the root, a crate, a package and a nested script directory merge into one config; dependency trees are not read", () => {
    // given each directory owning its part, plus a fragment inside node_modules
    const files = {
      "knip.base.jsonc": `// base\n${JSON.stringify(base)}`,
      "knip.workspace.jsonc": { workspaces: { ".": { includeEntryExports: true, entry: ["postinstall.mjs"] } } },
      "crates/a/knip.workspace.jsonc": { workspaces: { ".": { entry: ["crates/a/probes/p.ts"] } } },
      "packages/b/knip.workspace.jsonc": {
        workspaces: { "packages/b": { entry: ["src/index.ts"], ignoreIssues: { "src/x.ts": ["types"] } } },
        preExistingExports: { "packages/b/src/x.ts": ["unusedName"] },
      },
      "packages/b/node_modules/dep/knip.workspace.jsonc": { workspaces: { "packages/b/node_modules/dep": {} } },
      // a nested fragment owns its directory, so its entry is accepted there and not claimed by script/
      "script/knip.workspace.jsonc": { workspaces: { ".": { entry: ["script/run.ts"] } } },
      "script/qa/computer/knip.workspace.jsonc": { workspaces: { ".": { entry: ["script/qa/computer/probe.ts"] } } },
    }

    // when composed
    const config = withTree(files, composeKnipConfig)

    // then every part is present once, in fragment path order
    expect(config).toEqual({
      ...base,
      preprocessorOptions: {
        ...base.preprocessorOptions,
        preExistingExports: { "packages/b/src/x.ts": ["unusedName"] },
      },
      workspaces: {
        ".": {
          includeEntryExports: true,
          entry: ["postinstall.mjs", "crates/a/probes/p.ts", "script/run.ts", "script/qa/computer/probe.ts"],
        },
        "packages/b": { entry: ["src/index.ts"], ignoreIssues: { "src/x.ts": ["types"] } },
      },
    })
  })

  test.each([
    [
      "a crate's root entry kept in the root fragment",
      { "knip.workspace.jsonc": { workspaces: { ".": { entry: ["crates/a/x.ts"] } } } },
      `knip.workspace.jsonc: "crates/a/x.ts" belongs in crates/a/knip.workspace.jsonc`,
    ],
    [
      "a path kept in the script fragment while a deeper fragment owns its directory",
      {
        "script/x.ts": "",
        "script/knip.workspace.jsonc": { workspaces: { ".": { entry: ["script/qa/computer/probe.ts"] } } },
        "script/qa/computer/knip.workspace.jsonc": {},
      },
      `script/knip.workspace.jsonc: "script/qa/computer/probe.ts" belongs in script/qa/computer/knip.workspace.jsonc`,
    ],
    [
      "a workspace configured outside its own directory",
      { "packages/c/knip.workspace.jsonc": { workspaces: { "packages/b": {} } } },
      `packages/c/knip.workspace.jsonc: "packages/b" belongs in packages/b/knip.workspace.jsonc`,
    ],
    [
      "a pre-existing row for another directory's file",
      { "script/y.ts": "", "crates/a/knip.workspace.jsonc": { preExistingExports: { "script/y.ts": ["n"] } } },
      `crates/a/knip.workspace.jsonc: "script/y.ts" belongs in script/knip.workspace.jsonc`,
    ],
    [
      "a root flag set by two fragments",
      {
        "knip.workspace.jsonc": { workspaces: { ".": { includeEntryExports: true } } },
        "crates/a/knip.workspace.jsonc": { workspaces: { ".": { includeEntryExports: false } } },
      },
      `crates/a/knip.workspace.jsonc: workspaces / . / includeEntryExports is already set by another fragment`,
    ],
    [
      "an unknown fragment key",
      { "crates/a/knip.workspace.jsonc": { ignore: ["crates/a/**"] } },
      `crates/a/knip.workspace.jsonc: unknown key "ignore"`,
    ],
    [
      "workspaces kept in the base file",
      { "knip.base.jsonc": { ...base, workspaces: {} } },
      `knip.base.jsonc: "workspaces" belongs in knip.workspace.jsonc files`,
    ],
    [
      "a knip.jsonc left at the root, which knip would read instead of knip.ts",
      { "knip.jsonc": "{}" },
      `knip.jsonc: knip reads it before knip.ts: move its content into knip.base.jsonc and knip.workspace.jsonc files`,
    ],
  ])("refuses %s", (_name, files, message) => {
    expect(composeError(files)).toBe(message)
  })

  test("a checkout and its plain copy (no .git) discover the same fragments", () => {
    const files = {
      [FRAGMENT_FILE]: {},
      [`crates/a/${FRAGMENT_FILE}`]: {},
      [`packages/b/sub/${FRAGMENT_FILE}`]: {},
      [`packages/b/node_modules/dep/${FRAGMENT_FILE}`]: {},
      ".gitignore": "node_modules/\n",
    }
    withTree(files, (root) => {
      execFileSync("git", ["init", "-q"], { cwd: root })
      const inCheckout = fragmentDirs(root)
      rmSync(join(root, ".git"), { recursive: true, force: true })
      expect(inCheckout).toEqual([".", "crates/a", "packages/b/sub"])
      expect(fragmentDirs(root)).toEqual(inCheckout)
    })
  })

  // Sorted values keep two PRs that add to one fragment at different lines, so git merges them instead of conflicting.
  test("the repository's fragments compose and keep root-workspace paths and pre-existing rows sorted", () => {
    expect(() => composeKnipConfig(REPO_ROOT)).not.toThrow()
    const unsorted = fragmentDirs(REPO_ROOT).flatMap((dir) => {
      const file = posix.join(dir, FRAGMENT_FILE)
      const fragment = readJsonc(REPO_ROOT, file)
      const root = isObject(fragment["workspaces"]) ? fragment["workspaces"]["."] : undefined
      const lists: Array<[string, string[]]> = Object.entries(isObject(root) ? root : {})
        .filter(([key, value]) => PATH_KEYS.has(key) && Array.isArray(value))
        .map(([key, value]) => [key, Array.isArray(value) ? value.map(String) : []])
      lists.push([
        "preExistingExports",
        Object.keys(isObject(fragment["preExistingExports"]) ? fragment["preExistingExports"] : {}),
      ])
      return lists
        .filter(([, values]) => values.join("\n") !== [...values].sort().join("\n"))
        .map(([key]) => `${file} ${key}`)
    })
    expect(unsorted).toEqual([])
  })
})
