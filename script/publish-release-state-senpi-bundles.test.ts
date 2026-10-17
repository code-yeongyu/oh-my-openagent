/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"

import { runBlock } from "./release-workflow-test-steps"

const repoRoot = join(import.meta.dir, "..")
const buildCore: unknown = await import(pathToFileURL(join(repoRoot, "packages/omo-senpi/plugin/scripts/build-extension-core.mjs")).href)

function bundleOutputs(): string[] {
  if (typeof buildCore !== "object" || buildCore === null || !("resolveOutputs" in buildCore) || typeof buildCore.resolveOutputs !== "function") {
    throw new Error("build-extension-core.mjs no longer exports resolveOutputs")
  }
  const outputs: unknown = buildCore.resolveOutputs({})
  if (typeof outputs !== "object" || outputs === null) throw new Error("resolveOutputs returned no output map")
  return Object.values(outputs).filter((path): path is string => typeof path === "string").map((path) => relative(repoRoot, path).split(sep).join("/"))
}
const workflow = readFileSync(join(repoRoot, ".github", "workflows", "publish.yml"), "utf8")
const prepareStep = runBlock(workflow, "      - name: Prepare release state (generation)\n", "      - name: Publish prepared release state\n")
const senpiStaging = prepareStep.split("\n").filter((line) => /^git add .*packages\/omo-senpi\/plugin\/(extensions|runtime)/.test(line))

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`)
  return result.stdout
}

describe("release-state staging of the committed Senpi bundles", () => {
  test("stages every bundle build-extension.mjs rewrites, and no gitignored staged runtime", () => {
    const outputs = bundleOutputs()
    const root = mkdtempSync(join(tmpdir(), "omo-release-state-"))
    try {
      git(root, "init", "-q")
      writeFileSync(join(root, ".gitignore"), "packages/omo-senpi/plugin/runtime/lsp-daemon/\n")
      for (const path of outputs) {
        mkdirSync(join(root, dirname(path)), { recursive: true })
        writeFileSync(join(root, path), "before\n")
      }
      git(root, "add", "-A")
      git(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base")
      for (const path of outputs) writeFileSync(join(root, path), "after version stamp\n")
      const ignoredRuntime = "packages/omo-senpi/plugin/runtime/lsp-daemon/dist/cli.js"
      mkdirSync(join(root, dirname(ignoredRuntime)), { recursive: true })
      writeFileSync(join(root, ignoredRuntime), "staged runtime\n")

      const result = spawnSync("bash", ["-e", "-c", senpiStaging.join("\n")], { cwd: root, encoding: "utf8" })

      expect(result.status, result.stderr).toBe(0)
      const staged = git(root, "diff", "--cached", "--name-only").trim().split("\n")
      expect(staged.sort()).toEqual([...outputs].sort())
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
