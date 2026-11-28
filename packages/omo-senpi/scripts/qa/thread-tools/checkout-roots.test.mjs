import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const cli = fileURLToPath(new URL("./cli-surface.mjs", import.meta.url))

test("a direct CLI run names the missing Senpi checkout in one line", () => {
  const { status, stderr } = spawnSync(process.execPath, [cli], {
    env: { ...process.env, THREAD_QA_SENPI_ROOT: "", THREAD_QA_DESKTOP_ROOT: "" },
    encoding: "utf8",
  })
  expect(status).toBe(1)
  expect(stderr.trim().split(/\r?\n/)).toHaveLength(1)
  expect(stderr).toContain("set THREAD_QA_SENPI_ROOT")
})

test("a direct CLI run loads Senpi without requiring a desktop checkout", () => {
  // The script itself is a file, so treating it as a checkout deterministically fails at the first Senpi import.
  const { status, stderr } = spawnSync(process.execPath, [cli], {
    env: { ...process.env, THREAD_QA_SENPI_ROOT: cli, THREAD_QA_DESKTOP_ROOT: "" },
    encoding: "utf8",
  })
  expect(status).toBe(1)
  expect(stderr).toContain("env.mjs")
  expect(stderr).not.toContain("set THREAD_QA_DESKTOP_ROOT")
})
