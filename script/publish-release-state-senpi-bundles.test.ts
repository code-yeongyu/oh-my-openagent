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

  // Release contract (#12046): the service-auth bundle inlines packages/omo-native/package.json's
  // version, so the release commit must rebuild it after the bump and stage it, or the release-state
  // PR fails build-service-auth.test.ts as stale.
  test("rebuilds the service-auth bundle after the version bump and stages it", () => {
    const bundle = "packages/omo-native/bin/lib/service-auth.generated.js"
    const lines = prepareStep.split("\n")
    const bump = lines.findIndex((line) => line.includes("packages/omo-native/package.json > tmp.json"))
    const build = lines.findIndex((line) => /^bun (run )?script\/build-service-auth\.ts\b/.test(line))
    expect(bump).toBeGreaterThanOrEqual(0)
    expect(build).toBeGreaterThan(bump)

    const root = mkdtempSync(join(tmpdir(), "omo-release-state-"))
    try {
      git(root, "init", "-q")
      mkdirSync(join(root, dirname(bundle)), { recursive: true })
      writeFileSync(join(root, bundle), "version 1\n")
      git(root, "add", "-A")
      git(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base")
      writeFileSync(join(root, bundle), "version 2\n")
      const staging = lines.filter((line) => /^git add\b/.test(line) && line.includes("packages/omo-native/bin"))

      const result = spawnSync("bash", ["-e", "-c", staging.join("\n")], { cwd: root, encoding: "utf8" })

      expect(result.status, result.stderr).toBe(0)
      expect(git(root, "diff", "--cached", "--name-only").trim()).toBe(bundle)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
