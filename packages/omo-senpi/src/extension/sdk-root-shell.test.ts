/// <reference types="bun-types" />

import { spawnSync } from "node:child_process"
import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createSdkRootProvisioning } from "./sdk-root-provisioning"

const key = "OMO_TEST_SDK_ROOT"
const parents: string[] = []

afterEach(() => {
  delete process.env[key]
  for (const parent of parents.splice(0)) rmSync(parent, { recursive: true, force: true })
})

function bash(command: string, env: NodeJS.ProcessEnv): string {
  const result = spawnSync("bash", ["-c", command], { env, encoding: "utf8", cwd: tmpdir() })
  if (result.error) throw result.error
  return result.stdout
}

test("#given the sdk root variable is unset #when bash runs the unquoted ls probe #then it does not report NO_SDK_ENV", () => {
  // given
  const env = { ...process.env }
  delete env[key]

  // when
  const output = bash(`ls $${key} >/dev/null 2>&1 || echo NO_SDK_ENV`, env)

  // then
  expect(output.trim()).toBe("")
})

test("#given a published root whose path contains spaces and parentheses #when bash lists it #then the unquoted probe misses and the quoted probe hits", () => {
  // given
  const parent = mkdtempSync(join(tmpdir(), "sdk-shell-"))
  parents.push(parent)
  const root = join(parent, "OmO (Nightly).app", "Contents", "bunshin-ts")
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, "sdk.js"), "export {}\n")
  createSdkRootProvisioning({
    envKey: key,
    packagedRelativeDir: ".",
    sourceTreeRelativeDir: ".",
    baseDir: root,
  })()
  const env = { ...process.env }

  // when
  const unquoted = bash(`ls $${key} >/dev/null 2>&1 || echo NO_SDK_ENV`, env)
  const quoted = bash(`ls "$${key}" >/dev/null && echo QUOTED_OK`, env)

  // then
  expect(process.env[key]).toBe(root)
  expect(unquoted.trim()).toBe("NO_SDK_ENV")
  expect(quoted.trim()).toBe("QUOTED_OK")
})
