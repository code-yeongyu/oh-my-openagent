/// <reference types="bun-types" />

import { afterEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { windowsProcessEnv } from "./publish-operator-darwin-windows-env"

/**
 * Release contract (#13964 LOW-1): whatever goes wrong inside the verifier, the operator-darwin step ends with ONE
 * `::error::operator_darwin_artifacts refused: ...` line and exit 1, never a stack trace. Runs the real CLI.
 */

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test("an unexpected error inside the verifier is reported as the one typed refusal line", () => {
  const root = mkdtempSync(join(tmpdir(), "operator-darwin-cli-"))
  dirs.push(root)
  // --dir names a regular file, so listing it throws ENOTDIR: an error no check anticipates.
  const notADirectory = join(root, "artifacts")
  writeFileSync(notADirectory, "")
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../.github/workflows/operator-darwin-verify.ts", import.meta.url)),
      ...["--dir", notADirectory, "--tag", "operator-darwin-111111111111", "--manifest-sha256", "a".repeat(64)],
      ...["--prepared-sha", "2".repeat(40), "--version", "5.1.75", "--repo", root, "--summary", join(root, "rows.md")],
      ...["--actor", "maintainer", "--triggering-actor", "maintainer", "--repository", "o/r"],
    ],
    {
      encoding: "utf8",
      env: { ...windowsProcessEnv(), PATH: process.env.PATH ?? "", GH_TOKEN: "" },
      timeout: 20_000,
    },
  )
  expect(result.status).toBe(1)
  expect(result.stdout.trim().split("\n")).toEqual([
    expect.stringMatching(/^::error::operator_darwin_artifacts refused: unexpected verifier error: .*ENOTDIR/),
  ])
  expect(result.stderr).not.toContain("    at ")
})
